import type { Headers } from '../type/headers.type.ts';

export interface ExchangeDefinition {
  name: string;
  type: 'direct' | 'topic' | 'fanout' | 'headers';
  durable?: boolean;
  autoDelete?: boolean;
  internal?: boolean;
  arguments?: Headers;
}
