import type { ExchangeDefinition } from './exchange-definition.interface.ts';
import type { QueueDefinition } from './queue-definition.interface.ts';
import type { BindingDefinition } from './binding-definition.interface.ts';

export interface Topology {
  exchanges?: ExchangeDefinition[];
  queues?: QueueDefinition[];
  bindings?: BindingDefinition[];
}
