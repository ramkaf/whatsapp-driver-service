import { BufferJSON } from '@whiskeysockets/baileys';
import type { BaileysEventMap } from '@whiskeysockets/baileys';
import type { ConnectionMessageEvent } from '../../../connection/interfaces/message-event-source.ts';
import { toInboxEntries } from '../utils/message-inbox-entry.util.ts';

const key = {
  remoteJid: 'group@g.us',
  id: 'target',
  participant: 'author@s.whatsapp.net',
};
const base = { sessionId: 'account-one', at: '2026-11-11T10:00:00Z' };

describe('normalizing inbox events', () => {
  it('deduplicates identical reactions across eight sessions and property orders', () => {
    const [first] = toInboxEntries({
      ...base,
      event: 'messages.reaction',
      data: [
        {
          key,
          reaction: {
            text: '👍',
            senderTimestampMs: 100,
            key: { id: 'reaction-one', participant: 'actor@s.whatsapp.net' },
          },
        },
      ],
    });
    for (let i = 0; i < 8; i++) {
      const [copy] = toInboxEntries({
        ...base,
        sessionId: `account-${i}`,
        at: `local-time-${i}`,
        event: 'messages.reaction',
        data: [
          {
            reaction: {
              key: { participant: 'actor@s.whatsapp.net', id: 'reaction-one' },
              senderTimestampMs: 100,
              text: '👍',
            },
            key: {
              participant: key.participant,
              id: key.id,
              remoteJid: key.remoteJid,
            },
          },
        ],
      });
      expect(copy.key).toBe(first.key);
    }
  });

  it('preserves separate actors, reaction removals and later reactions to the same message', () => {
    const data = [
      {
        key,
        reaction: {
          text: '👍',
          senderTimestampMs: 100,
          key: { id: 'r1', participant: 'a@s.whatsapp.net' },
        },
      },
      {
        key,
        reaction: {
          text: '👍',
          senderTimestampMs: 100,
          key: { id: 'r2', participant: 'b@s.whatsapp.net' },
        },
      },
      {
        key,
        reaction: {
          text: '',
          senderTimestampMs: 200,
          key: { id: 'r3', participant: 'a@s.whatsapp.net' },
        },
      },
      {
        key,
        reaction: {
          text: '👍',
          senderTimestampMs: 300,
          key: { id: 'r4', participant: 'a@s.whatsapp.net' },
        },
      },
    ];
    const entries = toInboxEntries({
      ...base,
      event: 'messages.reaction',
      data,
    });
    expect(new Set(entries.map((entry) => entry.key)).size).toBe(4);
    expect(entries.map((entry) => entry.payload)).toEqual(data);
    expect(entries.every((entry) => !entry.haveMedia)).toBe(true);
  });

  it('distinguishes receipts by recipient and read/delivery timestamps', () => {
    const entries = toInboxEntries({
      ...base,
      event: 'message-receipt.update',
      data: [
        {
          key,
          receipt: { userJid: 'a@s.whatsapp.net', receiptTimestamp: 100 },
        },
        {
          key,
          receipt: {
            userJid: 'a@s.whatsapp.net',
            receiptTimestamp: 100,
            readTimestamp: 200,
          },
        },
        {
          key,
          receipt: { userJid: 'b@s.whatsapp.net', receiptTimestamp: 100 },
        },
      ],
    });
    expect(new Set(entries.map((entry) => entry.key)).size).toBe(3);
  });

  it('never merges an update, receipt or reaction with the target message or each other', () => {
    const events: ConnectionMessageEvent[] = [
      {
        ...base,
        event: 'messages.upsert',
        data: {
          type: 'notify',
          messages: [{ key, message: { conversation: 'hello' } }],
        },
      },
      {
        ...base,
        event: 'messages.update',
        data: [{ key, update: { status: 3 } }],
      },
      {
        ...base,
        event: 'message-receipt.update',
        data: [
          {
            key,
            receipt: { userJid: 'a@s.whatsapp.net', receiptTimestamp: 100 },
          },
        ],
      },
      {
        ...base,
        event: 'messages.reaction',
        data: [{ key, reaction: { text: '👍', senderTimestampMs: 100 } }],
      },
    ];
    expect(
      new Set(events.flatMap(toInboxEntries).map((entry) => entry.key)).size,
    ).toBe(4);
  });

  it('deduplicates deletions independently of delivery batch boundaries', () => {
    const other = { ...key, id: 'other' };
    const together = toInboxEntries({
      ...base,
      event: 'messages.delete',
      data: { keys: [key, other] },
    });
    const separately = [other, key].flatMap((item) =>
      toInboxEntries({
        ...base,
        sessionId: 'another-account',
        event: 'messages.delete',
        data: { keys: [item] },
      }),
    );
    expect(together.map((entry) => entry.key).sort()).toEqual(
      separately.map((entry) => entry.key).sort(),
    );
    expect(together.map((entry) => entry.payload)).toEqual([
      { keys: [key] },
      { keys: [other] },
    ]);
    expect(
      toInboxEntries({
        ...base,
        event: 'messages.delete',
        data: { jid: key.remoteJid, all: true },
      }),
    ).toMatchObject([
      {
        event: 'messages.delete',
        payload: { jid: key.remoteJid, all: true },
        haveMedia: false,
      },
    ]);
  });

  it('persists message-media notifications without treating ciphertext as a downloadable message', () => {
    const [entry] = toInboxEntries({
      ...base,
      event: 'messages.media-update',
      data: [
        {
          key,
          media: {
            ciphertext: new Uint8Array([0, 128, 255]),
            iv: new Uint8Array([1, 2]),
          },
          error: new Error(
            'media unavailable',
          ) as BaileysEventMap['messages.media-update'][number]['error'],
        },
      ],
    });
    expect(entry.haveMedia).toBe(false);
    expect(entry.payload).toMatchObject({
      error: { name: 'Error', message: 'media unavailable' },
    });
    const restored = JSON.parse(
      JSON.stringify(entry.payload),
      BufferJSON.reviver,
    );
    expect(restored.media.ciphertext).toEqual(Buffer.from([0, 128, 255]));
    expect(restored.media.iv).toEqual(Buffer.from([1, 2]));
  });

  it('splits contact/chat arrays and preserves object-shaped events', () => {
    expect(
      toInboxEntries({
        ...base,
        event: 'contacts.upsert',
        data: [{ id: 'a' }, { id: 'b' }],
      }),
    ).toMatchObject([{ payload: { id: 'a' } }, { payload: { id: 'b' } }]);
    expect(
      toInboxEntries({ ...base, event: 'chats.delete', data: ['a', 'b'] }),
    ).toMatchObject([{ payload: 'a' }, { payload: 'b' }]);
    const data = {
      id: 'chat',
      presences: { user: { lastKnownPresence: 'composing' as const } },
    };
    expect(
      toInboxEntries({ ...base, event: 'presence.update', data }),
    ).toMatchObject([{ event: 'presence.update', payload: data }]);
  });
});
