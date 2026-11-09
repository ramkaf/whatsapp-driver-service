import 'reflect-metadata';
import { EventEmitter } from 'node:events';
import type { Provider } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import type { WASocket } from '@whiskeysockets/baileys';
import { ConnectionMessageSource } from '../../connection/interfaces/message-event-source.ts';
import { SocketEventRegistrarService } from '../../connection/providers/socket/socket-event-registrar.service.ts';
import type { RealtimeService } from '../../connection/providers/realtime/realtime.service.ts';
import { MessagesReceiveModule } from '../receive/messages-receive.module.ts';
import { MessagesReceiveService } from '../receive/providers/messages-receive.service.ts';
import { SessionRepository } from '../../sessions/session.repository.ts';
import { MediaService } from '../../media/providers/media.service.ts';

const { appendFile, mkdir } = vi.hoisted(() => ({
  appendFile: vi.fn().mockResolvedValue(undefined),
  mkdir: vi.fn().mockResolvedValue(undefined),
}));
vi.mock('node:fs/promises', () => ({ appendFile, mkdir }));

it('writes every session message to its phone JSONL, preserving wrapped text and bigint metadata', async () => {
  const source = new SocketEventRegistrarService({
    publish: vi.fn(),
  } as unknown as RealtimeService);
  const module = await Test.createTestingModule({
    providers: [
      ...(Reflect.getMetadata(
        'providers',
        MessagesReceiveModule,
      ) as Provider[]),
      { provide: ConnectionMessageSource, useValue: source },
      { provide: MediaService, useValue: { hasMedia: () => false } },
      {
        provide: SessionRepository,
        useValue: {
          require: vi.fn(async (id: string) => ({
            phone: id === 'account-one' ? '989121234567' : '989131234567',
          })),
        },
      },
    ],
  }).compile();
  try {
    await module.init();
    for (const id of ['account-one', 'account-two']) {
      const ev = new EventEmitter();
      source.register(id, { ev } as unknown as WASocket);
      ev.emit('messages.upsert', {
        type: 'notify',
        messages: [
          {
            key: { id: 'plain', remoteJid: 'sender@s.whatsapp.net' },
            message: { conversation: 'پیام ساده' },
          },
          {
            key: { id: 'wrapped' },
            message: {
              ephemeralMessage: {
                message: {
                  extendedTextMessage: {
                    text: 'متن پیام تو در تو ' + 'x'.repeat(11000),
                    contextInfo: { stanzaId: 'quoted-message' },
                  },
                },
              },
            },
            messageTimestamp: 123n,
          },
        ],
      });
    }
    await module.get(MessagesReceiveService).onModuleDestroy();
    expect(appendFile).toHaveBeenCalledTimes(4);
    for (const phone of ['989121234567', '989131234567']) {
      expect(
        appendFile.mock.calls.filter(([path]) =>
          String(path).endsWith(`/storage/${phone}.jsonl`),
        ),
      ).toHaveLength(2);
    }
    const records = appendFile.mock.calls.map(([, line]) =>
      JSON.parse(String(line)),
    );
    expect(
      records
        .map((entry) => entry.sessionId)
        .sort((left: string, right: string) => left.localeCompare(right)),
    ).toEqual(['account-one', 'account-one', 'account-two', 'account-two']);
    expect(
      records.filter((entry) => entry.data.message.messageTimestamp === '123'),
    ).toHaveLength(2);
    const text = appendFile.mock.calls.map(([, line]) => String(line)).join('');
    expect(text).toContain('sender@s.whatsapp.net');
    expect(text).toContain('پیام ساده');
    expect(text).toContain('متن پیام تو در تو');
    expect(text).toContain('x'.repeat(11000));
    expect(text).toContain('quoted-message');
    expect(text).not.toContain('[Object]');
  } finally {
    await module.close();
  }
});
