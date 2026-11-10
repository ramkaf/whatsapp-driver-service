import type { Channel, ChannelModel } from 'amqplib';
import { within } from '../common/helper/async.helper.ts';
import type { Session } from '../common/interface/session.interface.ts';

/** Owns channel creation and invalidates a session on unexpected channel closure. */
export class RabbitMQChannelManager {
  constructor(
    private readonly timeout: number,
    private readonly invalidate: (session: Session) => void,
  ) {}

  async createSession(connection: ChannelModel): Promise<Session> {
    const control = await within(connection.createChannel(), this.timeout);
    control.on('error', () => undefined);
    const publisher = await within(
      connection.createConfirmChannel(),
      this.timeout,
    );
    publisher.on('error', () => undefined);
    const session: Session = {
      connection,
      control,
      publisher,
      closed: false,
      blocked: false,
    };
    control.on('close', () => this.invalidate(session));
    publisher.on('close', () => this.invalidate(session));
    publisher.on('drain', () => {
      session.releaseDrain?.();
      session.drain = undefined;
    });
    return session;
  }

  async create(
    session: Session,
    shouldRecover: () => boolean = () => true,
  ): Promise<Channel> {
    const channel = await within(
      session.connection.createChannel(),
      this.timeout,
    );
    channel.on('error', () => undefined);
    channel.on('close', () => {
      if (!session.closed && shouldRecover()) this.invalidate(session);
    });
    return channel;
  }
}
