import { Span } from "@opentelemetry/api";
import { InstrumentationConfig } from "@opentelemetry/instrumentation";
import {
  ClientMetrics,
  DeliveryReport,
  EofEvent,
  LibrdKafkaError,
  Message,
  Metadata,
  ReadyInfo,
  SubscribeTopicList,
  TopicPartition,
  TopicPartitionOffset,
} from "@confluentinc/kafka-javascript";

interface MessageInfo<T = Message> {
  topic: string;
  message: T;
}

interface KafkaProducerCustomAttributeFunction<T = Message> {
  (span: Span, info: MessageInfo<T>): void;
}

interface KafkaConsumerCustomAttributeFunction<T = Message> {
  (span: Span, info: MessageInfo<T>): void;
}

export interface ConfluentKafkaInstrumentationConfig
  extends InstrumentationConfig {
  /** hook for adding custom attributes before producer message is sent */
  producerHook?: KafkaProducerCustomAttributeFunction;
  /** hook for adding custom attributes before consumer message is processed */
  consumerHook?: KafkaConsumerCustomAttributeFunction;
  moduleVersionAttributeName?: string;
}

type KafkaClientEvents =
  | "disconnected"
  | "ready"
  | "connection.failure"
  | "event.error"
  | "event.stats"
  | "event.log"
  | "event.event"
  | "event.throttle";

export type KafkaConsumerEvents =
  | "data"
  | "partition.eof"
  | "rebalance"
  | "rebalance.error"
  | "subscribed"
  | "unsubscribed"
  | "unsubscribe"
  | "offset.commit"
  | KafkaClientEvents;

export type KafkaProducerEvents = "delivery-report" | KafkaClientEvents;

type EventListenerMap = {
  // ### Client
  // connectivity events
  disconnected: (metrics: ClientMetrics) => void;
  ready: (info: ReadyInfo, metadata: Metadata) => void;
  "connection.failure": (
    error: LibrdKafkaError,
    metrics: ClientMetrics
  ) => void;
  // event messages
  "event.error": (error: LibrdKafkaError) => void;
  "event.stats": (eventData: any) => void;
  "event.log": (eventData: any) => void;
  "event.event": (eventData: any) => void;
  "event.throttle": (eventData: any) => void;
  // ### Consumer only
  // domain events
  data: (arg: Message) => void;
  "partition.eof": (arg: EofEvent) => void;
  rebalance: (err: LibrdKafkaError, assignments: TopicPartition[]) => void;
  "rebalance.error": (err: Error) => void;
  // connectivity events
  subscribed: (topics: SubscribeTopicList) => void;
  unsubscribe: () => void;
  unsubscribed: () => void;
  // offsets
  "offset.commit": (
    error: LibrdKafkaError,
    topicPartitions: TopicPartitionOffset[]
  ) => void;
  // ### Producer only
  // delivery
  "delivery-report": (error: LibrdKafkaError, report: DeliveryReport) => void;
};

export type EventListener<K extends string> = K extends keyof EventListenerMap
  ? EventListenerMap[K]
  : never;
