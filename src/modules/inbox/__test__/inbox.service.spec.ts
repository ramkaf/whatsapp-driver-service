import { Logger } from '@nestjs/common';
import type { MockInstance } from 'vitest';
import type { PrismaService } from '@libs/common/prisma/index.js';
import type { Prisma } from '@libs/common/prisma/src/index.js';
import type { WAMessage } from '@whiskeysockets/baileys';
import { InboxService } from '../providers/inbox.service.ts';
import { deserializeInboxMessage } from '../utils/inbox.util.ts';

const key = {
  remoteJid: 'chat@s.whatsapp.net',
  id: 'message-one',
  fromMe: false,
};

describe('InboxService', () => {
  let upsert: ReturnType<typeof vi.fn>;
  let inbox: InboxService;
  let loggedError: MockInstance;

  beforeEach(() => {
    vi.spyOn(Logger.prototype, 'log').mockImplementation(() => {});
    loggedError = vi
      .spyOn(Logger.prototype, 'error')
      .mockImplementation(() => {});
    upsert = vi.fn().mockResolvedValue({});
    inbox = new InboxService({
      whatsappMessageInbox: { upsert },
    } as unknown as PrismaService);
  });
  afterEach(() => vi.restoreAllMocks());

  it('stores plain text ready for downstream processing under the originating session', async () => {
    const message: WAMessage = {
      key,
      message: { conversation: 'پیام بدون فایل' },
    };
    await inbox.handle(message, 'account-one');
    expect(upsert).toHaveBeenCalledExactlyOnceWith({
      where: { key: expect.any(String) },
      create: {
        key: expect.any(String),
        payload: message,
        sessionId: 'account-one',
        haveMedia: false,
        mediaStatus: 'NOT_REQUIRED',
        status: 'READY',
      },
      update: {},
    });
  });

  it('queues wrapped media while preserving the bytes needed for a later download', async () => {
    const mediaKey = new Uint8Array([0, 1, 128, 255]);
    const message: WAMessage = {
      key,
      message: {
        viewOnceMessageV2: {
          message: { imageMessage: { mediaKey, mimetype: 'image/jpeg' } },
        },
      },
    };
    await inbox.handle(message, 'account-two');
    const { create } = upsert.mock
      .calls[0][0] as Prisma.WhatsappMessageInboxUpsertArgs;
    expect(create).toMatchObject({
      sessionId: 'account-two',
      haveMedia: true,
      mediaStatus: 'PENDING',
      status: 'RECEIVED',
    });
    const restored = deserializeInboxMessage(
      create.payload as Prisma.JsonValue,
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
    'does not insert own messages or messages missing required identifiers: %j',
    async (messageKey) => {
      await inbox.handle(
        { key: messageKey, message: { conversation: 'hello' } },
        'account-one',
      );
      expect(upsert).not.toHaveBeenCalled();
    },
  );

  it('deduplicates re-deliveries without resetting a previously processed record', async () => {
    const first: WAMessage = { key, message: { conversation: 'original' } };
    await inbox.handle(first, 'account-one');
    await inbox.handle(
      { ...first, message: { conversation: 're-delivery' } },
      'account-one',
    );
    const [initial, repeated] = upsert.mock.calls.map(
      ([query]) => query as Prisma.WhatsappMessageInboxUpsertArgs,
    );
    expect(initial.where.key).toBe(initial.create.key);
    expect(repeated.where).toEqual(initial.where);
    expect(repeated.update).toEqual({});
    await inbox.handle(
      { ...first, key: { ...key, remoteJid: 'other@s.whatsapp.net' } },
      'account-one',
    );
    expect(upsert.mock.calls[2][0].where.key).not.toBe(initial.where.key);
  });

  it('contains persistence failures so the socket consumer can continue', async () => {
    const failure = new Error('database unavailable');
    upsert.mockRejectedValueOnce(failure);
    await expect(
      inbox.handle({ key, message: { conversation: 'hello' } }, 'account-one'),
    ).resolves.toBeUndefined();
    expect(loggedError).toHaveBeenCalledWith(
      'Failed to save incoming WhatsApp message',
      failure.stack,
    );
    await inbox.handle(
      { key: { ...key, id: 'second' }, message: { conversation: 'next' } },
      'account-one',
    );
    expect(upsert).toHaveBeenCalledTimes(2);
  });
});
