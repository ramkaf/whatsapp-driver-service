import type { Headers } from '../type/headers.type.ts';

export interface PublishOptions {
  messageId?: string;
  headers?: Headers;
  timeoutMs?: number;
  mandatory?: boolean;
  persistent?: boolean;
  correlationId?: string;
  replyTo?: string;
  expiration?: string;
}
