import type {
  ConnectionMessageEvent,
  MessageEventName,
} from '../../../connection/interfaces/message-event-source.ts';

/** Each handler owns one event and receives only that event's typed payload. */
export abstract class MessageEventHandler<
  K extends MessageEventName = MessageEventName,
> {
  abstract readonly event: K;
  abstract handle(event: ConnectionMessageEvent<K>): void | Promise<void>;
}

export const MESSAGE_EVENT_HANDLERS = Symbol('MESSAGE_EVENT_HANDLERS');
