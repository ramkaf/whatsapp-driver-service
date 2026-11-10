import type { Channel } from 'amqplib';
import type { MessageHandler } from '../type/message-handler.type.ts';
import type { ConsumerOptions } from './consumer-options.interface.ts';

export interface Consumer {
  id: string;
  queue: string;
  handler: MessageHandler;
  options: ConsumerOptions;
  channel?: Channel;
  tag?: string;
  stopped: boolean;
  tasks: Set<Promise<void>>;
}
