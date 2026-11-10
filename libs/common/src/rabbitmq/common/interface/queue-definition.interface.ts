import type { Headers } from '../type/headers.type.ts';

export interface QueueDefinition {
  name: string;
  durable?: boolean;
  autoDelete?: boolean;
  arguments?: Headers;
}
