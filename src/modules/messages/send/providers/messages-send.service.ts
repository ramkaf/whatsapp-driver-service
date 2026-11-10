import type {
  SendMessageCommand,
  SendMessageResult,
} from '../interfaces/send-message.ts';

/** Contract only. No implementation or provider is registered until sending is built. */
export abstract class MessagesSendService {
  abstract send(command: SendMessageCommand): Promise<SendMessageResult>;
}
