import type { MessageContext } from '../interface/message-context.interface.ts';

export type MessageHandler<T = unknown, R = unknown> = (
  data: T,
  context: MessageContext,
) => Promise<R> | R;
