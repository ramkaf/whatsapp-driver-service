import type { TraceAdapter } from './trace-adapter.interface.ts';

export interface RabbitMQOptions {
  url: string;
  /** Read-only shared JSON file; loaded once per application instance. */
  topologyPath: string;
  connectTimeoutMs?: number;
  operationTimeoutMs?: number;
  reconnect?: { initialDelayMs?: number; maxDelayMs?: number };
  prefetch?: number;
  requeueDelayMs?: number;
  shutdownTimeoutMs?: number;
  maxPendingPublishes?: number;
  maxPendingRequests?: number;
  rpcTimeoutMs?: number;
  trace?: TraceAdapter;
}
