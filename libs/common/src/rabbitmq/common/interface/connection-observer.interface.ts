import type { Session } from './session.interface.ts';
import type { RabbitMQError } from '../error/rabbitmq.error.ts';

/** Internal lifecycle coordination; observers never open another connection. */
export interface ConnectionObserver {
  ready?(session: Session): Promise<void> | void;
  lost?(error: RabbitMQError): void;
}
