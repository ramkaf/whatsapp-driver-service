import 'reflect-metadata';
import { EventEmitter } from 'node:events';
import { Test } from '@nestjs/testing';
import type { TestingModule } from '@nestjs/testing';
import { Logger } from '@nestjs/common';
import type { Provider } from '@nestjs/common';
import type { WASocket } from '@whiskeysockets/baileys';
import { SocketEventRegistrarService } from '../../connection/providers/socket/socket-event-registrar.service.ts';
import type { RealtimeService } from '../../connection/providers/realtime/realtime.service.ts';
import { ConnectionMessageSource } from '../../connection/interfaces/message-event-source.ts';
import { MessagesReceiveModule } from '../receive/messages-receive.module.ts';
import { MessagesReceiveService } from '../receive/providers/messages-receive.service.ts';
import { ConsoleMessageEventOutput } from '../receive/providers/console-message-event-output.service.ts';
import { MessageEventOutput } from '../receive/interfaces/message-event-output.ts';
import { MediaService } from '../../media/providers/media.service.ts';
import { SessionRepository } from '../../sessions/session.repository.ts';
import { JsonlUtil } from '../../../utils/jsonl.util.ts';

const first = {
  key: { remoteJid: 'chat@s.whatsapp.net', id: 'first', fromMe: false },
  message: { conversation: 'hello' },
};
const second = {
  key: { id: 'second', fromMe: true },
  message: { conversation: 'own echo' },
};

describe('Receiving message events from connection sockets', () => {
  let module: TestingModule;
  let source: SocketEventRegistrarService;
  let publish: ReturnType<typeof vi.fn>;
  let write: ReturnType<typeof vi.fn>;
  let save: ReturnType<typeof vi.fn>;
  beforeEach(async () => {
    publish = vi.fn();
    write = vi.fn();
    save = vi.fn();
    source = new SocketEventRegistrarService({
      publish,
    } as unknown as RealtimeService);
    module = await Test.createTestingModule({
      providers: [
        ...(Reflect.getMetadata(
          'providers',
          MessagesReceiveModule,
        ) as Provider[]),
        { provide: ConnectionMessageSource, useValue: source },
        {
          provide: MediaService,
          useValue: {
            hasMedia: (message: { message?: { imageMessage?: unknown } }) =>
              !!message.message?.imageMessage,
            save,
          },
        },
      ],
    })
      .overrideProvider(MessageEventOutput)
      .useValue({ write })
      .compile();
    await module.init();
  });
  afterEach(async () => {
    await module.close();
    vi.restoreAllMocks();
  });

  it.each([
    ['messages.upsert', { messages: [first, second], type: 'notify' }, 2],
    ['messages.update', [{ key: first.key, update: { status: 3 } }], 1],
    ['messages.delete', { keys: [first.key, second.key] }, 2],
    ['messages.delete', { jid: 'chat@s.whatsapp.net', all: true }, 1],
    [
      'messages.reaction',
      [
        { key: first.key, reaction: { text: '👍' } },
        { key: second.key, reaction: { text: '' } },
      ],
      2,
    ],
    [
      'messages.media-update',
      [{ key: first.key, error: new Error('media unavailable') }],
      1,
    ],
    [
      'message-receipt.update',
      [
        {
          key: first.key,
          receipt: { userJid: 'reader@s.whatsapp.net', readTimestamp: 1 },
        },
      ],
      1,
    ],
    [
      'messaging-history.set',
      { messages: [first, second], chats: [], contacts: [], isLatest: true },
      2,
    ],
    [
      'messaging-history.status',
      { syncType: 0, status: 'complete', explicit: true },
      1,
    ],
  ])(
    'dispatches %s to its handler and outputs each item',
    async (event, data, count) => {
      const ev = new EventEmitter();
      source.register('account-one', { ev } as unknown as WASocket);
      ev.emit(event as string, data);
      await vi.waitFor(() =>
        expect(write).toHaveBeenCalledTimes(count as number),
      );
      for (const [entry] of write.mock.calls) {
        expect(entry).toMatchObject({
          sessionId: 'account-one',
          event,
          at: expect.any(String),
        });
        expect(entry.data).toBeDefined();
      }
      expect(publish).toHaveBeenCalledWith('account-one', event, data);
    },
  );

  it('receives every account without a browser and subscribes only once', async () => {
    module.get(MessagesReceiveService).onModuleInit();
    for (const id of ['one', 'two', 'three']) {
      const ev = new EventEmitter();
      source.register(id, { ev } as unknown as WASocket);
      ev.emit('messages.upsert', { messages: [first], type: 'append' });
    }
    await vi.waitFor(() => expect(write).toHaveBeenCalledTimes(3));
    expect(write.mock.calls.map(([event]) => event.sessionId)).toEqual([
      'one',
      'two',
      'three',
    ]);
    expect(write.mock.calls[0]![0].data).toMatchObject({
      type: 'append',
      message: first,
    });
  });

  it('removes listeners on socket disposal and rejects stale generations or closed sockets', async () => {
    const ev = new EventEmitter();
    let current = true;
    const dispose = source.register(
      'old',
      { ev } as unknown as WASocket,
      () => current,
    );
    const payload = { messages: [first], type: 'notify' };
    ev.emit('messages.upsert', payload);
    current = false;
    ev.emit('messages.upsert', payload);
    current = true;
    ev.emit('connection.update', { connection: 'close' });
    ev.emit('messages.upsert', payload);
    dispose();
    ev.emit('connection.update', { connection: 'open' });
    ev.emit('messages.upsert', payload);
    await vi.waitFor(() => expect(write).toHaveBeenCalledOnce());
    expect(ev.listenerCount('messages.upsert')).toBe(0);
    expect(ev.listenerCount('connection.update')).toBe(0);
  });

  it('keeps other consumers and later messages working after a handler fails', async () => {
    vi.spyOn(Logger.prototype, 'error').mockImplementation(() => {});
    const consumer = vi.fn();
    source.subscribe(consumer);
    const ev = new EventEmitter();
    source.register('one', { ev } as unknown as WASocket);
    write.mockImplementationOnce(() => {
      throw new Error('output failed');
    });
    const payload = { messages: [first], type: 'notify' };
    expect(() => ev.emit('messages.upsert', payload)).not.toThrow();
    ev.emit('messages.upsert', payload);
    await vi.waitFor(() => expect(write).toHaveBeenCalledTimes(2));
    expect(consumer).toHaveBeenCalledTimes(2);
    expect(publish).toHaveBeenCalledTimes(2);
  });

  it('unsubscribes when the receiving module shuts down', async () => {
    await module.get(MessagesReceiveService).onModuleDestroy();
    const ev = new EventEmitter();
    source.register('one', { ev } as unknown as WASocket);
    ev.emit('messages.upsert', { messages: [first], type: 'notify' });
    expect(write).not.toHaveBeenCalled();
  });

  it('writes the handled record to the session phone JSONL output', async () => {
    const append = vi.spyOn(JsonlUtil, 'append').mockResolvedValue(undefined);
    const repository = {
      require: vi.fn().mockResolvedValue({ phone: '989121234567' }),
    };
    const record = {
      sessionId: 'one',
      event: 'messages.upsert' as const,
      at: new Date().toISOString(),
      data: first,
    };
    await new ConsoleMessageEventOutput(
      repository as unknown as SessionRepository,
    ).write(record);
    expect(repository.require).toHaveBeenCalledWith('one');
    expect(append).toHaveBeenCalledWith('989121234567', record);
  });

  it.each(['messages.upsert', 'messaging-history.set', 'messages.update'])(
    'stores an attachment before outputting %s and records its MinIO metadata',
    async (event) => {
      const message = {
        ...first,
        message: { imageMessage: { mimetype: 'image/jpeg' } },
      };
      const stored = {
        bucket: 'test-media',
        objectKey: 'conversations/chat@s.whatsapp.net/image.jpg',
        etag: 'etag',
        url: 'https://storage.test/test-media/conversations/chat@s.whatsapp.net/image.jpg?signature=test',
        urlExpiresAt: '2026-11-16T00:00:00.000Z',
        chatId: first.key.remoteJid,
        messageId: first.key.id,
        senderId: first.key.remoteJid,
        type: 'image',
        mimeType: 'image/jpeg',
        originalFileName: null,
      };
      let complete!: (result: typeof stored) => void;
      save.mockImplementation(
        () =>
          new Promise((resolve) => {
            complete = resolve;
          }),
      );
      const ev = new EventEmitter();
      const socket = { ev, updateMediaMessage: vi.fn() };
      source.register('one', socket as unknown as WASocket);
      const payload =
        event === 'messages.update'
          ? [{ key: message.key, update: { message: message.message } }]
          : { messages: [message], type: 'notify', chats: [], contacts: [] };

      ev.emit(event, payload);
      expect(save).toHaveBeenCalledWith(
        expect.objectContaining({ updateMediaMessage: expect.any(Function) }),
        expect.objectContaining({ key: message.key, message: message.message }),
      );
      expect(write).not.toHaveBeenCalled();
      expect(publish).toHaveBeenCalledWith('one', event, payload);
      complete(stored);

      await vi.waitFor(() => expect(write).toHaveBeenCalledOnce());
      expect(write.mock.calls[0][0]).toMatchObject({
        sessionId: 'one',
        event,
        media: stored,
      });
      expect(write.mock.calls[0][0]).not.toHaveProperty('mediaError');
    },
  );

  it('retains a failed media message and continues the batch and other sessions', async () => {
    vi.spyOn(Logger.prototype, 'error').mockImplementation(() => {});
    save.mockRejectedValueOnce(new Error('download unavailable'));
    const ev = new EventEmitter();
    source.register('one', {
      ev,
      updateMediaMessage: vi.fn(),
    } as unknown as WASocket);
    ev.emit('messages.upsert', {
      type: 'notify',
      messages: [
        { ...first, message: { imageMessage: { mimetype: 'image/jpeg' } } },
        second,
      ],
    });
    const other = new EventEmitter();
    source.register('two', { ev: other } as unknown as WASocket);
    other.emit('messages.upsert', { messages: [first], type: 'notify' });
    await vi.waitFor(() => expect(write).toHaveBeenCalledTimes(3));
    expect(
      write.mock.calls.find(([entry]) => entry.mediaError)?.[0],
    ).toMatchObject({
      sessionId: 'one',
      mediaError: 'MEDIA_STORAGE_FAILED',
      data: { message: { key: first.key } },
    });
    expect(write.mock.calls.some(([entry]) => entry.sessionId === 'two')).toBe(
      true,
    );
    expect(save).toHaveBeenCalledOnce();
  });

  it('contains rejected asynchronous output without interrupting later events', async () => {
    const error = vi
      .spyOn(Logger.prototype, 'error')
      .mockImplementation(() => {});
    write.mockRejectedValueOnce(new Error('output unavailable'));
    const ev = new EventEmitter();
    source.register('one', { ev } as unknown as WASocket);
    ev.emit('messages.upsert', { messages: [first], type: 'notify' });
    await vi.waitFor(() =>
      expect(error).toHaveBeenCalledWith({
        sessionId: 'one',
        event: 'messages.upsert',
        reason: 'message_handler_failed',
      }),
    );
    ev.emit('messages.upsert', { messages: [second], type: 'notify' });
    await vi.waitFor(() => expect(write).toHaveBeenCalledTimes(2));
  });

  it('preserves a media message when its session socket is no longer available', async () => {
    vi.spyOn(Logger.prototype, 'error').mockImplementation(() => {});
    vi.spyOn(source, 'getMediaDownloadContext').mockReturnValue(undefined);
    const ev = new EventEmitter();
    source.register('one', { ev } as unknown as WASocket);
    ev.emit('messages.upsert', {
      messages: [{ ...first, message: { imageMessage: {} } }],
      type: 'notify',
    });
    await vi.waitFor(() => expect(write).toHaveBeenCalledOnce());
    expect(write.mock.calls[0][0]).toMatchObject({
      sessionId: 'one',
      mediaError: 'MEDIA_STORAGE_FAILED',
      data: { message: { key: first.key } },
    });
    expect(save).not.toHaveBeenCalled();
  });

  it('waits for pending media and output when the receiver shuts down', async () => {
    let complete!: () => void;
    write.mockImplementationOnce(
      () =>
        new Promise<void>((resolve) => {
          complete = resolve;
        }),
    );
    const ev = new EventEmitter();
    source.register('one', { ev } as unknown as WASocket);
    ev.emit('messages.upsert', { messages: [first], type: 'notify' });
    await vi.waitFor(() => expect(write).toHaveBeenCalledOnce());
    let stopped = false;
    const closing = module
      .get(MessagesReceiveService)
      .onModuleDestroy()
      .then(() => {
        stopped = true;
      });
    await Promise.resolve();
    expect(stopped).toBe(false);
    ev.emit('messages.upsert', { messages: [second], type: 'notify' });
    complete();
    await closing;
    expect(write).toHaveBeenCalledOnce();
  });
});
