import type { WAMessage, WAMessageContent } from '@whiskeysockets/baileys';
import { InboxRepository, type PrismaService } from '@libs/prisma';
import type { Prisma } from '@database/client.js';
import { InboxService } from '../../../inbox/providers/inbox.service.ts';
import {
  deserializeInboxMessage,
  generateMessageFingerprint,
} from '../../../inbox/utils/inbox.util.ts';
import { MessagesUpsertEventHandler } from '../events/message-upsert/messages-upsert.event.ts';
import { MessageChatType } from '../events/message-upsert/utils/message-upsert.util.ts';

const key = {
  id: 'message-one',
  remoteJid: 'chat@s.whatsapp.net',
  fromMe: false,
};

describe('MessagesUpsertEventHandler', () => {
  let createMany: ReturnType<typeof vi.fn>;
  let handler: MessagesUpsertEventHandler;

  beforeEach(() => {
    createMany = vi.fn().mockResolvedValue({ count: 1 });
    handler = new MessagesUpsertEventHandler(
      new InboxService(
        new InboxRepository({
          whatsappMessageInbox: { createMany },
        } as unknown as PrismaService),
      ),
    );
  });

  async function receive(messages: WAMessage[]) {
    await handler.handle({
      event: 'messages.upsert',
      sessionId: 'account-one',
      at: '',
      data: { messages, type: 'notify' },
    });
  }

  it('stores the reformed text alongside the original payload and unchanged message key', async () => {
    const message = { key, message: { conversation: 'سلام' } };
    await receive([message]);
    expect(createMany).toHaveBeenCalledExactlyOnceWith({
      data: [
        {
          key: generateMessageFingerprint(key.remoteJid, key.id),
          event: 'messages.upsert',
          sessionId: 'account-one',
          payload: message,
          reformPayload: {
            conversationId: key.remoteJid,
            chatType: MessageChatType.PRIVATE,
            sender: {
              whatsappId: key.remoteJid,
              username: null,
              phoneNumber: null,
              displayName: null,
            },
            messageId: key.id,
            content: 'سلام',
            media: { path: null, thumbnail: null, mimeType: null },
          },
          haveMedia: false,
          mediaStatus: 'NOT_REQUIRED',
          status: 'READY',
        },
      ],
      skipDuplicates: true,
    });
  });

  it.each([
    [{ conversation: 'plain text' }, 'plain text'],
    [{ extendedTextMessage: { text: 'extended text' } }, 'extended text'],
    [
      {
        ephemeralMessage: {
          message: { extendedTextMessage: { text: 'wrapped text' } },
        },
      },
      'wrapped text',
    ],
    [
      { imageMessage: { caption: 'image caption', mimetype: 'image/jpeg' } },
      'image caption',
    ],
    [
      { videoMessage: { caption: 'video caption', mimetype: 'video/mp4' } },
      'video caption',
    ],
    [
      {
        documentWithCaptionMessage: {
          message: {
            documentMessage: {
              caption: 'document caption',
              mimetype: 'application/pdf',
            },
          },
        },
      },
      'document caption',
    ],
    [{ audioMessage: { mimetype: 'audio/ogg' } }, null],
  ] satisfies [WAMessageContent, string | null][])(
    'extracts readable text or caption while retaining media data: %j',
    async (content, expectedText) => {
      await receive([{ key, message: content }]);
      const record = createMany.mock.calls[0][0].data[0];
      expect(record.reformPayload.content).toBe(expectedText);
      expect(record.reformPayload.media).toEqual({
        path: null,
        thumbnail: null,
        mimeType: null,
      });
      expect(record.payload.message).toEqual(content);
    },
  );

  it.each([
    { reactionMessage: { key, text: '👍', senderTimestampMs: 100 } },
    { reactionMessage: { key, text: '', senderTimestampMs: 200 } },
    { ephemeralMessage: { message: { reactionMessage: { key, text: '👍' } } } },
    { encReactionMessage: {} },
  ] satisfies WAMessageContent[])(
    'skips reaction messages and continues with later messages: %j',
    async (reaction) => {
      const accepted = {
        key: { ...key, id: 'accepted' },
        message: { conversation: 'hello' },
      };
      await receive([{ key, message: reaction }, accepted]);
      expect(createMany).toHaveBeenCalledOnce();
      expect(createMany.mock.calls[0][0].data[0]).toMatchObject({
        payload: accepted,
        reformPayload: { messageId: 'accepted', content: 'hello' },
      });
    },
  );

  it.each([
    {
      name: 'private phone chat with username and display name',
      message: {
        key: {
          ...key,
          remoteJid: '989121234567:4@s.whatsapp.net',
          remoteJidUsername: 'alice',
        },
        pushName: 'Alice',
      },
      expected: {
        chatType: MessageChatType.PRIVATE,
        sender: {
          whatsappId: '989121234567@s.whatsapp.net',
          username: 'alice',
          phoneNumber: '+989121234567',
          displayName: 'Alice',
        },
      },
    },
    {
      name: 'private LID chat with an alternate phone JID',
      message: {
        key: {
          ...key,
          remoteJid: '123456789@lid',
          remoteJidAlt: '989121234567@s.whatsapp.net',
          remoteJidUsername: 'alice',
        },
      },
      expected: {
        chatType: MessageChatType.PRIVATE,
        sender: {
          whatsappId: '123456789@lid',
          username: 'alice',
          phoneNumber: '+989121234567',
          displayName: null,
        },
      },
    },
    {
      name: 'LID-only sender without an exposed phone number or username',
      message: { key: { ...key, remoteJid: '123456789@lid' } },
      expected: {
        chatType: MessageChatType.PRIVATE,
        sender: {
          whatsappId: '123456789@lid',
          username: null,
          phoneNumber: null,
          displayName: null,
        },
      },
    },
    {
      name: 'group sender with alternate phone and participant username',
      message: {
        key: {
          ...key,
          remoteJid: '120363000000000@g.us',
          participant: '123456789:22@lid',
          participantAlt: '989121234567@s.whatsapp.net',
          participantUsername: 'alice',
          remoteJidUsername: 'not-the-sender',
        },
        pushName: 'Alice',
      },
      expected: {
        chatType: MessageChatType.GROUP,
        sender: {
          whatsappId: '123456789@lid',
          username: 'alice',
          phoneNumber: '+989121234567',
          displayName: 'Alice',
        },
      },
    },
    {
      name: 'group participant expressed as a phone JID',
      message: {
        key: {
          ...key,
          remoteJid: '120363000000000@g.us',
          participant: '989121234567@s.whatsapp.net',
        },
      },
      expected: {
        chatType: MessageChatType.GROUP,
        sender: {
          whatsappId: '989121234567@s.whatsapp.net',
          username: null,
          phoneNumber: '+989121234567',
          displayName: null,
        },
      },
    },
    {
      name: 'group message without participant identity',
      message: { key: { ...key, remoteJid: '120363000000000@g.us' } },
      expected: {
        chatType: MessageChatType.GROUP,
        sender: {
          whatsappId: null,
          username: null,
          phoneNumber: null,
          displayName: null,
        },
      },
    },
    {
      name: 'group message with a top-level participant',
      message: {
        key: { ...key, remoteJid: '120363000000000@g.us' },
        participant: '989121234567@s.whatsapp.net',
      },
      expected: {
        chatType: MessageChatType.GROUP,
        sender: {
          whatsappId: '989121234567@s.whatsapp.net',
          username: null,
          phoneNumber: '+989121234567',
          displayName: null,
        },
      },
    },
    {
      name: 'status broadcast instead of a personal chat',
      message: {
        key: {
          ...key,
          remoteJid: 'status@broadcast',
          participant: '989121234567@s.whatsapp.net',
        },
      },
      expected: {
        chatType: MessageChatType.UNKNOWN,
        sender: {
          whatsappId: '989121234567@s.whatsapp.net',
          username: null,
          phoneNumber: '+989121234567',
          displayName: null,
        },
      },
    },
  ] satisfies { name: string; message: WAMessage; expected: object }[])(
    'extracts sender details for $name',
    async ({ message, expected }) => {
      const input = { ...message, message: { conversation: 'hello' } };
      await receive([input]);
      const record = createMany.mock.calls[0][0].data[0];
      expect(record.reformPayload).toMatchObject(expected);
      expect(record.payload).toEqual(input);
      expect(record.reformPayload.conversationId).toBe(input.key.remoteJid);
    },
  );

  it('skips own messages', async () => {
    await receive([
      {
        key: { ...key, fromMe: true },
        message: { conversation: 'sent by me' },
      },
    ]);
    expect(createMany).not.toHaveBeenCalled();
  });

  it('keeps wrapped attachment bytes available to the media worker', async () => {
    const mediaKey = new Uint8Array([0, 128, 255]);
    await receive([
      {
        key,
        message: {
          viewOnceMessageV2: {
            message: {
              imageMessage: {
                mediaKey,
                caption: 'caption',
                mimetype: 'image/jpeg',
              },
            },
          },
        },
      },
    ]);
    const record = createMany.mock.calls[0][0].data[0];
    expect(record).toMatchObject({
      haveMedia: true,
      mediaStatus: 'PENDING',
      status: 'RECEIVED',
      reformPayload: {
        content: 'caption',
        media: { path: null, thumbnail: null, mimeType: null },
      },
    });
    const restored = deserializeInboxMessage(
      record.payload as Prisma.JsonValue,
    );
    expect(
      Buffer.from(
        restored.message!.viewOnceMessageV2!.message!.imageMessage!.mediaKey!,
      ),
    ).toEqual(Buffer.from(mediaKey));
  });
});
