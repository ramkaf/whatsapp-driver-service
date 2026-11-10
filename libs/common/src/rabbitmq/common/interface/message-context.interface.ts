import type { Headers } from '../type/headers.type.ts';

export interface MessageContext {
  messageId: string;
  headers: Headers;
  correlationId?: string;
  replyTo?: string;
  redelivered: boolean;
}
