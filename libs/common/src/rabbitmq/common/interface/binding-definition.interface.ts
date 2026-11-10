import type { Headers } from '../type/headers.type.ts';

export interface BindingDefinition {
  queue: string;
  exchange: string;
  routingKey: string;
  arguments?: Headers;
}
