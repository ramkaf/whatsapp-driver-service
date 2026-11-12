import { InboxRepository, type PrismaService } from '@libs/prisma';
import type { Prisma } from '@database/client.js';
import type { WAMessage } from '@whiskeysockets/baileys';
import { InboxService } from '../providers/inbox.service.ts';
import {
  deserializeInboxMessage,
  generateMessageFingerprint,
} from '../utils/inbox.util.ts';
import { toInboxEntries } from '../../messages/receive/utils/message-inbox-entry.util.ts';

const key = {
  remoteJid: 'chat@s.whatsapp.net',
  id: 'message-one',
  fromMe: false,
};

describe('InboxService', () => {
  let createMany: ReturnType<typeof vi.fn>;
  let inbox: InboxService;

  beforeEach(() => {
    createMany = vi.fn().mockResolvedValue({ count: 1 });
    inbox = new InboxService(
      new InboxRepository({
        whatsappMessageInbox: { createMany },
      } as unknown as PrismaService),
    );
  });

  async function receive(message: WAMessage, sessionId = 'account-one') {
    for (const entry of toInboxEntries({
      event: 'messages.upsert',
      sessionId,
      at: '',
      data: { messages: [message], type: 'notify' },
    }))
      await inbox.handle(entry);
  }

  it('stores plain text with its event and the original message fingerprint', async () => {
    const message = { key, message: { conversation: 'پیام بدون فایل' } };
    await receive(message);
    expect(createMany).toHaveBeenCalledExactlyOnceWith({
      data: [
        {
          key: generateMessageFingerprint(key.remoteJid, key.id),
          event: 'messages.upsert',
          payload: message,
          sessionId: 'account-one',
          haveMedia: false,
          mediaStatus: 'NOT_REQUIRED',
          status: 'READY',
        },
      ],
      skipDuplicates: true,
    });
  });

  it('queues wrapped media while preserving the bytes needed for a later download', async () => {
    const mediaKey = new Uint8Array([0, 1, 128, 255]);
    await receive(
      {
        key,
        message: {
          viewOnceMessageV2: {
            message: { imageMessage: { mediaKey, mimetype: 'image/jpeg' } },
          },
        },
      },
      'account-two',
    );
    const record = createMany.mock.calls[0][0].data[0];
    expect(record).toMatchObject({
      sessionId: 'account-two',
      haveMedia: true,
      mediaStatus: 'PENDING',
      status: 'RECEIVED',
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

  it.each([
    { ...key, fromMe: true },
    { ...key, id: undefined },
    { ...key, remoteJid: undefined },
  ])(
    'does not insert own messages or incomplete keys: %j',
    async (messageKey) => {
      await receive({ key: messageKey, message: { conversation: 'hello' } });
      expect(createMany).not.toHaveBeenCalled();
    },
  );

  it('retains one processed record across eight simultaneous sessions and history replay', async () => {
    const rows = new Map<string, Record<string, unknown>>();
    createMany.mockImplementation(async ({ data, skipDuplicates }) => {
      expect(skipDuplicates).toBe(true);
      for (const entry of data) {
        if (!rows.has(entry.key))
          rows.set(entry.key, { ...entry, status: 'PROCESSED' });
      }
      return { count: 1 };
    });
    const message = { key, message: { conversation: 'original' } };
    await Promise.all(
      Array.from({ length: 8 }, (_, i) => receive(message, `account-${i}`)),
    );
    const original = rows.values().next().value;
    for (const entry of toInboxEntries({
      event: 'messaging-history.set',
      sessionId: 'history-account',
      at: '',
      data: { messages: [message], chats: [], contacts: [] },
    }))
      await inbox.handle(entry);
    expect(rows.size).toBe(1);
    expect(rows.values().next().value).toBe(original);
    expect(original).toMatchObject({
      sessionId: 'account-0',
      status: 'PROCESSED',
      event: 'messages.upsert',
    });
    await receive({
      ...message,
      key: { ...key, remoteJid: 'other@s.whatsapp.net' },
    });
    expect(rows.size).toBe(2);
  });

  it('stores reactions as ready notifications without scheduling a media download', async () => {
    const reaction = { key, reaction: { text: '👍', senderTimestampMs: 123 } };
    const [entry] = toInboxEntries({
      event: 'messages.reaction',
      sessionId: 'account-one',
      at: '',
      data: [reaction],
    });
    await inbox.handle(entry);
    expect(createMany.mock.calls[0][0].data[0]).toMatchObject({
      event: 'messages.reaction',
      payload: reaction,
      haveMedia: false,
      mediaStatus: 'NOT_REQUIRED',
      status: 'READY',
    });
  });

  it('propagates persistence failures for the receiving boundary to report', async () => {
    const failure = new Error('database unavailable');
    createMany.mockRejectedValueOnce(failure);
    await expect(
      receive({ key, message: { conversation: 'hello' } }),
    ).rejects.toBe(failure);
    await receive({
      key: { ...key, id: 'second' },
      message: { conversation: 'next' },
    });
    expect(createMany).toHaveBeenCalledTimes(2);
  });
});
