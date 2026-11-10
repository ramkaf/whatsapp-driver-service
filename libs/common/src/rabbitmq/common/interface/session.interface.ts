import type { Channel, ChannelModel, ConfirmChannel } from 'amqplib';

export interface Session {
  connection: ChannelModel;
  control: Channel;
  publisher: ConfirmChannel;
  closed: boolean;
  blocked: boolean;
  drain?: Promise<void>;
  releaseDrain?: () => void;
}
