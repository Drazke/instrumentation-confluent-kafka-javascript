import {
  InstrumentationBase,
  InstrumentationModuleDefinition,
  InstrumentationNodeModuleDefinition,
  isWrapped,
} from "@opentelemetry/instrumentation";
import {
  ConfluentKafkaInstrumentationConfig,
  EventListener,
  KafkaConsumerEvents,
  KafkaProducerEvents,
} from "./types";
import * as ConfluentKafka from "@confluentinc/kafka-javascript";
import {
  context,
  diag,
  propagation,
  ROOT_CONTEXT,
  SpanKind,
  SpanStatusCode,
  trace,
} from "@opentelemetry/api";
import { bufferTextMapGetter } from "./propagator";
import { isPromise } from "node:util/types";
import {
  ATTR_MESSAGING_CLIENT_ID,
  ATTR_MESSAGING_CONSUMER_GROUP_NAME,
  ATTR_MESSAGING_DESTINATION_NAME,
  ATTR_MESSAGING_DESTINATION_PARTITION_ID,
  ATTR_MESSAGING_KAFKA_MESSAGE_KEY,
  ATTR_MESSAGING_KAFKA_MESSAGE_TOMBSTONE,
  ATTR_MESSAGING_KAFKA_OFFSET,
  ATTR_MESSAGING_OPERATION_NAME,
  ATTR_MESSAGING_OPERATION_TYPE,
  ATTR_MESSAGING_SYSTEM,
  MESSAGING_OPERATION_TYPE_VALUE_DELIVER,
  MESSAGING_OPERATION_TYPE_VALUE_RECEIVE,
  MESSAGING_OPERATION_TYPE_VALUE_SEND,
  MESSAGING_SYSTEM_VALUE_KAFKA,
} from "@opentelemetry/semantic-conventions/incubating";
import { version, name } from "../package.json";

export class ConfluentKafkaInstrumentation extends InstrumentationBase {
  protected declare _config: ConfluentKafkaInstrumentationConfig;

  constructor(config: ConfluentKafkaInstrumentationConfig = {}) {
    super(name, version, config);
  }

  protected init():
    | void
    | InstrumentationModuleDefinition
    | InstrumentationModuleDefinition[] {
    const module = new InstrumentationNodeModuleDefinition(
      "@confluentinc/kafka-javascript",
      [">=1.3.0"],
      this.patch.bind(this),
      this.unpatch.bind(this)
    );
    return module;
  }

  protected patch(moduleExports: typeof ConfluentKafka): typeof ConfluentKafka {
    diag.debug("confluent-kafka instrumentation: applying patch");
    this.unpatch(moduleExports);
    this._wrap(
      moduleExports?.Producer.prototype,
      "produce",
      this._patchProduce()
    );
    this._wrap(
      moduleExports?.Producer.prototype,
      "on",
      this._patchProducerOn()
    );
    this._wrap(moduleExports?.KafkaConsumer.prototype, "on", this._patchOn());
    return moduleExports;
  }

  protected unpatch(moduleExports: typeof ConfluentKafka): void {
    diag.debug("confluent-kafka instrumentation: un-patching");
    if (isWrapped(moduleExports?.Producer?.prototype.produce)) {
      this._unwrap(moduleExports.Producer.prototype, "produce");
    }
    if (isWrapped(moduleExports?.Producer?.prototype.on)) {
      this._unwrap(moduleExports.Producer.prototype, "on");
    }
    if (isWrapped(moduleExports?.KafkaConsumer?.prototype.on)) {
      this._unwrap(moduleExports.KafkaConsumer.prototype, "on");
    }
  }

  private _patchOn() {
    const self = this;
    return (original: ConfluentKafka.KafkaConsumer["on"]) => {
      return function (
        this: any,
        ev: KafkaConsumerEvents,
        originalListener: EventListener<KafkaConsumerEvents>
      ) {
        const eventName = ev;
        if (eventName !== "data") {
          return original.apply(this, [ev, originalListener]);
        }
        const wrappedListener = function (
          this: any,
          data: ConfluentKafka.Message
        ) {
          const ctx =
            data?.headers &&
            propagation.extract(
              ROOT_CONTEXT,
              data?.headers?.find((v) => !!v["traceparent"]),
              bufferTextMapGetter
            );
          const span = self.tracer.startSpan(
            data.topic ?? eventName,
            {
              kind: SpanKind.CONSUMER,
              attributes: {
                [ATTR_MESSAGING_SYSTEM]: MESSAGING_SYSTEM_VALUE_KAFKA,
                [ATTR_MESSAGING_DESTINATION_NAME]: data.topic,
                [ATTR_MESSAGING_OPERATION_NAME]: "received",
                [ATTR_MESSAGING_OPERATION_TYPE]:
                  MESSAGING_OPERATION_TYPE_VALUE_RECEIVE,
                [ATTR_MESSAGING_KAFKA_MESSAGE_KEY]: data.key?.toString(),
                [ATTR_MESSAGING_KAFKA_MESSAGE_TOMBSTONE]:
                  data?.key && data.value === null ? true : undefined,
                [ATTR_MESSAGING_KAFKA_OFFSET]: data.offset.toString(),
                [ATTR_MESSAGING_CONSUMER_GROUP_NAME]: data.headers
                  ?.find((h) => h.key === "group-id")
                  ?.value?.toString(),
                [ATTR_MESSAGING_DESTINATION_PARTITION_ID]:
                  data.partition.toString(),
                [ATTR_MESSAGING_CLIENT_ID]: data.headers
                  ?.find((h) => h.key === "client-id")
                  ?.value?.toString(),
              },
            },
            ctx
          );
          if (self._config.consumerHook) {
            self._config.consumerHook(span, {
              topic: data?.topic,
              message: data,
            });
          }
          return context.with(trace.setSpan(context.active(), span), () =>
            self.endSpan(
              () =>
                (originalListener as EventListener<"data">).apply(this, [data]),
              span
            )
          );
        };
        return original.apply(this, [ev, wrappedListener]);
      };
    };
  }

  private _patchProducerOn() {
    const self = this;
    return (original: ConfluentKafka.Producer["on"]) => {
      return function (
        this: any,
        ev: KafkaProducerEvents,
        originalListener: EventListener<KafkaProducerEvents>
      ) {
        const eventName = ev;
        if (eventName !== "delivery-report") {
          return original.apply(this, [ev, originalListener]);
        }
        const wrappedListener = function (
          this: any,
          err: ConfluentKafka.LibrdKafkaError,
          report: ConfluentKafka.DeliveryReport
        ) {
          const ctx =
            report?.opaque && propagation.extract(ROOT_CONTEXT, report.opaque);
          const span = self.tracer.startSpan(
            report?.topic ?? eventName,
            {
              kind: SpanKind.PRODUCER,
              attributes: {
                [ATTR_MESSAGING_SYSTEM]: MESSAGING_SYSTEM_VALUE_KAFKA,
                [ATTR_MESSAGING_DESTINATION_NAME]: report?.topic,
                [ATTR_MESSAGING_OPERATION_NAME]: "delivery-report",
                [ATTR_MESSAGING_OPERATION_TYPE]:
                  MESSAGING_OPERATION_TYPE_VALUE_DELIVER,
              },
            },
            ctx
          );
          if (err && err.code !== ConfluentKafka.CODES.ERRORS.ERR_NO_ERROR) {
            span.setStatus({
              code: SpanStatusCode.ERROR,
              message: err.message,
            });
          } else {
            span.setAttributes({
              [ATTR_MESSAGING_DESTINATION_PARTITION_ID]:
                report?.partition?.toString(),
              [ATTR_MESSAGING_KAFKA_OFFSET]: report?.offset?.toString(),
              [ATTR_MESSAGING_KAFKA_MESSAGE_KEY]: report?.key?.toString(),
            });
          }
          return context.with(trace.setSpan(context.active(), span), () =>
            self.endSpan(
              () =>
                (originalListener as EventListener<"delivery-report">).apply(
                  this,
                  [err, report]
                ),
              span
            )
          );
        };
        return original.apply(this, [ev, wrappedListener]);
      };
    };
  }

  private _patchProduce() {
    const self = this;
    return (original: ConfluentKafka.Producer["produce"]) => {
      return function (
        this: any,
        topic: string,
        partition: ConfluentKafka.NumberNullUndefined,
        message: ConfluentKafka.MessageValue,
        key?: ConfluentKafka.MessageKey,
        timestamp?: ConfluentKafka.NumberNullUndefined,
        opaque?: any,
        headers?: ConfluentKafka.MessageHeader[]
      ) {
        if (!headers) {
          headers = [];
        }
        const span = self.tracer.startSpan(topic, {
          kind: SpanKind.PRODUCER,
          attributes: {
            [ATTR_MESSAGING_SYSTEM]: MESSAGING_SYSTEM_VALUE_KAFKA,
            [ATTR_MESSAGING_DESTINATION_NAME]: topic,
            [ATTR_MESSAGING_KAFKA_MESSAGE_KEY]: key?.toString(),
            [ATTR_MESSAGING_KAFKA_MESSAGE_TOMBSTONE]:
              key && message === null ? true : undefined,
            [ATTR_MESSAGING_DESTINATION_PARTITION_ID]: partition?.toString(),
            [ATTR_MESSAGING_OPERATION_NAME]: "produce",
            [ATTR_MESSAGING_OPERATION_TYPE]:
              MESSAGING_OPERATION_TYPE_VALUE_SEND,
            [ATTR_MESSAGING_CLIENT_ID]: headers
              .find((h) => h.key === "client-id")
              ?.value?.toString(),
          },
        });
        const ctx = trace.setSpan(context.active(), span);
        headers.push({});
        propagation.inject(ctx, headers[headers.length - 1]);
        propagation.inject(ctx, opaque ?? {});
        if (self._config.producerHook) {
          self._config.producerHook(span, {
            topic,
            message: {
              topic,
              partition: partition ?? 0,
              offset: -1,
              size: 0,
              value: message,
              key: key,
              timestamp: timestamp ?? 0,
              opaque: opaque,
              headers: headers,
            },
          });
        }
        return context.with(ctx, () =>
          self.endSpan(
            () =>
              original.apply(this, [
                topic,
                partition,
                message,
                key,
                timestamp,
                opaque,
                headers,
              ]),
            span
          )
        );
      };
    };
  }

  private endSpan(traced: any, span: any) {
    try {
      const result = traced();
      if (isPromise(result)) {
        return result.then(
          (value) => {
            span.end();
            return value;
          },
          (err) => {
            span.recordException(err);
            span.setStatus({
              code: SpanStatusCode.ERROR,
              message: err?.message,
            });
            span.end();
            throw err;
          }
        );
      } else {
        span.end();
        return result;
      }
    } catch (error) {
      span.recordException(error);
      span.setStatus({
        code: SpanStatusCode.ERROR,
        message: error instanceof Error ? error.message : String(error),
      });
      span.end();
      throw error;
    }
  }
}
