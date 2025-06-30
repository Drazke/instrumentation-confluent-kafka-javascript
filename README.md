# OpenTelemetry `confluent-kafka-javascript` Instrumentation for Node.js

[![NPM Published Version][npm-img]][npm-url]
[![Apache License][license-image]][license-image]

Inspired by [`@eqxjs/kafka-server-node-rdkafka`](https://www.npmjs.com/package/@eqxjs/kafka-server-node-rdkafka) and [`@opentelemetry/instrumentation-kafkajs`](https://www.npmjs.com/package/@opentelemetry/instrumentation-kafkajs)

This module provides automatic instrumentation for the [`@confluentinc/kafka-javascript`](https://www.npmjs.com/package/@confluentinc/kafka-javascript) package, which may be loaded using the [`@opentelemetry/sdk-trace-node`](https://github.com/open-telemetry/opentelemetry-js/tree/main/packages/opentelemetry-sdk-trace-node) package and is included in the [`@opentelemetry/auto-instrumentations-node`](https://www.npmjs.com/package/@opentelemetry/auto-instrumentations-node) bundle.

If total installation size is not constrained, it is recommended to use the [`@opentelemetry/auto-instrumentations-node`](https://www.npmjs.com/package/@opentelemetry/auto-instrumentations-node) bundle with [@opentelemetry/sdk-node](`https://www.npmjs.com/package/@opentelemetry/sdk-node`) for the most seamless instrumentation experience.

Compatible with OpenTelemetry JS API and SDK `1.0+`.

## Installation

```bash
npm install --save @drazke/instrumentation-confluent-kafka-javascript
```

### Supported versions

- [`@confluentinc/kafka-javascript`](https://www.npmjs.com/package/@confluentinc/kafka-javascript) versions `>=1.3.0`

## Usage

```js
const { NodeTracerProvider } = require('@opentelemetry/sdk-trace-node');
const {
  KafkaJsInstrumentation,
} = require('@drazke/instrumentation-confluent-kafka-javascript');
const { registerInstrumentations } = require('@opentelemetry/instrumentation');

const provider = new NodeTracerProvider();
provider.register();

registerInstrumentations({
  instrumentations: [
    new ConfluentKafkaInstrumentation({
      // see below for available configuration
    }),
  ],
});
```

### Instrumentation Options

You can set the following:

| Options        | Type                                   | Description                                                                                              |
| -------------- | -------------------------------------- | -------------------------------------------------------------------------------------------------------- |
| `producerHook` | `KafkaProducerCustomAttributeFunction` | Function called before a producer message is sent. Allows for adding custom attributes to the span.      |
| `consumerHook` | `KafkaConsumerCustomAttributeFunction` | Function called before a consumer message is processed. Allows for adding custom attributes to the span. |

## Semantic Conventions

This package uses `@opentelemetry/semantic-conventions` version `1.30+`, which implements Semantic Convention [Version 1.30.0](https://github.com/open-telemetry/semantic-conventions/blob/v1.30.0/docs/README.md)

### Spans Emitted

| KafkaJS Object | Action                     | Span Kind | Span Name      | Operation Type / Name         |
| -------------- | -------------------------- | --------- | -------------- | ----------------------------- |
| Consumer       | `data`                     | Consumer  | `<topic-name>` | `receive` / `received`        |
| Producer       | `delivery-report`          | Producer  | `<topic-name>` | `deliver` / `delivery-report` |
| Producer       | `produce`                  | Producer  | `<topic-name>` | `send` / `produce`            |

### Attributes Collected

These attributes are added to both spans and metrics, where possible.

| Attribute                            | Short Description                                                                                                                                                  |
| ------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `messaging.system`                   | An identifier for the messaging system being used (i.e. `"kafka"`).                                                                                                |
| `messaging.destination.name`         | The message destination name.                                                                                                                                      |
| `messaging.operation.type`           | A string identifying the type of messaging operation.                                                                                                              |
| `messaging.operation.name`           | The system-specific name of the messaging operation.                                                                                                               |
| `messaging.client.id`                | The client id.                                                                                                               |
| `messaging.kafka.message.key`        | A stringified value representing the key of the Kafka message (if present).                                                                                        |
| `messaging.kafka.message.tombstone`  | A boolean that is true if the message is a tombstone.                                                                                                              |
| `messaging.kafka.offset`             | The offset of a record in the corresponding Kafka partition.                                                                                                       |
| `messaging.destination.partition.id` | The identifier of the partition messages are sent to or received from, unique within the `messaging.destination.name`. **Note:** only available on producer spans. |

## Useful links

- For more information on OpenTelemetry, visit: <https://opentelemetry.io/>

## License

Apache 2.0 - See [LICENSE][license-url] for more information.

[license-url]: https://github.com/drazke/opentelemetry-js-contrib/blob/main/LICENSE
[license-image]: https://img.shields.io/badge/license-Apache_2.0-green.svg?style=flat
[npm-url]: https://www.npmjs.com/package/@drazke/instrumentation-confluent-kafka-javascript
[npm-img]: https://badge.fury.io/js/%40drazke%2Finstrumentation-confluent-kafka-javascript.svg
