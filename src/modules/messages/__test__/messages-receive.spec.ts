import 'reflect-metadata';
import { EventEmitter } from 'node:events';
import { Test } from '@nestjs/testing';
import type { TestingModule } from '@nestjs/testing';
import { Logger } from '@nestjs/common';
import type { Provider } from '@nestjs/common';
import type { BaileysEventMap, WASocket } from '@whiskeysockets/baileys';
import { SocketEventRegistrarService } from '../../connection/providers/socket/socket-event-registrar.service.ts';
import type { RealtimeService } from '../../connection/providers/realtime/realtime.service.ts';
import {
  ConnectionMessageSource,
  MESSAGE_EVENTS,
} from '../../connection/interfaces/message-event-source.ts';
import { MessagesReceiveModule } from '../receive/messages-receive.module.ts';
import { MessagesReceiveService } from '../receive/providers/messages-receive.service.ts';
import { MESSAGE_EVENT_HANDLERS } from '../receive/interfaces/message-event-handler.ts';
import type { MessageEventHandler } from '../receive/interfaces/message-event-handler.ts';
import { InboxService } from '../../inbox/providers/inbox.service.ts';
import { toInboxEntries } from '../receive/utils/message-inbox-entry.util.ts';

const first = {
  key: { remoteJid: 'chat@s.whatsapp.net', id: 'first', fromMe: false },
  message: { conversation: 'hello' },
};
const second = {
  key: { remoteJid: 'other@s.whatsapp.net', id: 'second', fromMe: false },
  message: { imageMessage: { mimetype: 'image/jpeg' } },
};

describe('Receiving events from connection sockets', () => {
  let module: TestingModule;
  let source: SocketEventRegistrarService;
  let receiver: MessagesReceiveService;
  let handlers: MessageEventHandler[];
  let publish: ReturnType<typeof vi.fn>;
  let handle: ReturnType<typeof vi.fn>;
  let subscribe: ReturnType<typeof vi.spyOn>;
  let loggedError: ReturnType<typeof vi.spyOn>;

  beforeEach(async () => {
    publish = vi.fn();
    handle = vi.fn().mockResolvedValue(undefined);
    vi.spyOn(Logger.prototype, 'log').mockImplementation(() => {});
    loggedError = vi
      .spyOn(Logger.prototype, 'error')
      .mockImplementation(() => {});
    source = new SocketEventRegistrarService({
      publish,
    } as unknown as RealtimeService);
    subscribe = vi.spyOn(source, 'subscribe');
    module = await Test.createTestingModule({
      providers: [
        ...(Reflect.getMetadata(
          'providers',
          MessagesReceiveModule,
        ) as Provider[]),
        { provide: ConnectionMessageSource, useValue: source },
        { provide: InboxService, useValue: { handle } },
      ],
    }).compile();
    await module.init();
    receiver = module.get(MessagesReceiveService);
    handlers = module.get<MessageEventHandler[]>(MESSAGE_EVENT_HANDLERS);
  });

  afterEach(async () => {
    await module?.close();
    vi.restoreAllMocks();
  });

  it('registers exactly one handler for every event accepted by the socket source', () => {
    const names = handlers.map((handler) => handler.event);
    expect(new Set(names).size).toBe(names.length);
    expect(names.toSorted((a, b) => a.localeCompare(b))).toEqual(
      [...MESSAGE_EVENTS].sort((a, b) => a.localeCompare(b)),
    );
  });

  it.each(MESSAGE_EVENTS)(
    'routes %s to its handler with the correct session and payload',
    async (event) => {
      const selected = handlers.find((handler) => handler.event === event)!;
      const called = vi.spyOn(selected, 'handle').mockImplementation(() => {});
      const ev = new EventEmitter();
      source.register('account-one', { ev } as unknown as WASocket);
      // Routing is independent of business logic, including handlers that are still templates.
      const data = { marker: event };
      ev.emit(event, data);
      await receiver.onModuleDestroy();
      expect(called).toHaveBeenCalledExactlyOnceWith({
        sessionId: 'account-one',
        event,
        at: expect.any(String),
        data,
      });
      expect(publish).toHaveBeenCalledExactlyOnceWith(
        'account-one',
        event,
        data,
      );
    },
  );

  it.each(['notify', 'append'] as const)(
    'persists every message in a %s batch without an output-service dependency',
    async (type) => {
      const ev = new EventEmitter();
      source.register('account-one', { ev } as unknown as WASocket);
      ev.emit('messages.upsert', { messages: [first, second], type });
      await receiver.onModuleDestroy();
      expect(handle.mock.calls).toEqual(
        toInboxEntries({
          event: 'messages.upsert',
          sessionId: 'account-one',
          at: '',
          data: { messages: [first, second], type },
        }).map((entry) => [expect.objectContaining(entry)]),
      );
    },
  );

  it.each(['add', 'remove', 'promote', 'demote', 'modify'] as const)(
    'skips inbox writes for disabled group participant action %s',
    async (action) => {
      const ev = new EventEmitter();
      source.register('account-one', { ev } as unknown as WASocket);
      const data: BaileysEventMap['group-participants.update'] = {
        id: 'group@g.us',
        author: 'admin@lid',
        authorPn: 'admin@s.whatsapp.net',
        participants: [
          { id: 'member@lid', phoneNumber: 'member@s.whatsapp.net' },
        ],
        action,
      };
      ev.emit('group-participants.update', data);
      await receiver.onModuleDestroy();
      expect(handle).not.toHaveBeenCalled();
    },
  );

  it('skips inbox writes when a member leaves the group', async () => {
    const ev = new EventEmitter();
    source.register('account-one', { ev } as unknown as WASocket);
    const data: BaileysEventMap['group-participants.update'] = {
      id: 'group@g.us',
      author: 'member@lid',
      participants: [{ id: 'member@lid' }],
      action: 'remove',
    };
    ev.emit('group-participants.update', data);
    await receiver.onModuleDestroy();
    expect(handle).not.toHaveBeenCalled();
  });

  it('publishes group metadata updates without saving them to the inbox', async () => {
    const ev = new EventEmitter();
    source.register('account-one', { ev } as unknown as WASocket);
    const updates: BaileysEventMap['groups.update'] = [
      {
        id: 'first@g.us',
        subject: 'New name',
        desc: 'New description',
        author: 'admin@lid',
      },
      {
        id: 'second@g.us',
        announce: true,
        restrict: true,
        inviteCode: 'new-invite',
        memberAddMode: false,
        joinApprovalMode: true,
      },
    ];
    ev.emit('groups.update', updates);
    await receiver.onModuleDestroy();
    expect(handle).not.toHaveBeenCalled();
    expect(publish).toHaveBeenCalledExactlyOnceWith(
      'account-one',
      'groups.update',
      updates,
    );
  });

  it('skips inbox writes for newly discovered group metadata', async () => {
    const ev = new EventEmitter();
    source.register('account-one', { ev } as unknown as WASocket);
    const group: BaileysEventMap['groups.upsert'][number] = {
      id: 'group@g.us',
      owner: 'admin@lid',
      subject: 'Group',
      participants: [{ id: 'member@lid' }],
    };
    ev.emit('groups.upsert', [group]);
    await receiver.onModuleDestroy();
    expect(handle).not.toHaveBeenCalled();
  });

  it.each(['created', 'revoked', 'rejected'] as const)(
    'skips inbox writes for a %s group join request',
    async (action) => {
      const ev = new EventEmitter();
      source.register('account-one', { ev } as unknown as WASocket);
      const data: BaileysEventMap['group.join-request'] = {
        id: 'group@g.us',
        author: 'admin@lid',
        participant: 'member@lid',
        action,
        method: 'invite_link',
      };
      ev.emit('group.join-request', data);
      await receiver.onModuleDestroy();
      expect(handle).not.toHaveBeenCalled();
    },
  );

  it('skips inbox writes for group member label changes', async () => {
    const ev = new EventEmitter();
    source.register('account-one', { ev } as unknown as WASocket);
    const data: BaileysEventMap['group.member-tag.update'] = {
      groupId: 'group@g.us',
      participant: 'member@lid',
      participantAlt: 'member@s.whatsapp.net',
      label: 'Organizer',
      messageTimestamp: 123,
    };
    ev.emit('group.member-tag.update', data);
    await receiver.onModuleDestroy();
    expect(handle).not.toHaveBeenCalled();
  });

  it('skips historical messages while their handler is disabled', async () => {
    const ev = new EventEmitter();
    source.register('account-one', { ev } as unknown as WASocket);
    ev.emit('messaging-history.set', {
      messages: [first, second],
      chats: [],
      contacts: [],
    });
    await receiver.onModuleDestroy();
    expect(handle).not.toHaveBeenCalled();
  });

  it('subscribes only once and preserves the source session for simultaneous accounts', async () => {
    receiver.onModuleInit();
    for (const id of ['one', 'two', 'three']) {
      const ev = new EventEmitter();
      source.register(id, { ev } as unknown as WASocket);
      ev.emit('messages.upsert', { messages: [first], type: 'notify' });
    }
    await receiver.onModuleDestroy();
    expect(subscribe).toHaveBeenCalledOnce();
    expect(
      handle.mock.calls
        .map(([entry]) => entry.sessionId)
        .sort((a: string, b: string) => a.localeCompare(b)),
    ).toEqual(['one', 'three', 'two']);
  });

  it('contains a rejected handler while other consumers and later events continue', async () => {
    handle.mockRejectedValueOnce(new Error('inbox unavailable'));
    const consume = vi.fn();
    source.subscribe(consume);
    const ev = new EventEmitter();
    source.register('one', { ev } as unknown as WASocket);
    ev.emit('messages.upsert', { messages: [first, second], type: 'notify' });
    await receiver.onModuleDestroy();
    expect(handle.mock.calls).toEqual(
      [first, second]
        .flatMap((message) =>
          toInboxEntries({
            event: 'messages.upsert',
            sessionId: 'one',
            at: '',
            data: { messages: [message], type: 'notify' },
          }),
        )
        .map((entry) => [expect.objectContaining(entry)]),
    );
    expect(consume).toHaveBeenCalledOnce();
    expect(publish).toHaveBeenCalledOnce();
    expect(loggedError).toHaveBeenCalledWith(
      expect.objectContaining({
        sessionId: 'one',
        event: 'messages.upsert',
        reason: 'message_handler_failed',
        error: expect.any(AggregateError),
      }),
    );
  });

  it('stops receiving immediately on shutdown and waits for an in-flight inbox write', async () => {
    let release!: () => void;
    handle.mockImplementationOnce(
      () =>
        new Promise<void>((resolve) => {
          release = resolve;
        }),
    );
    const ev = new EventEmitter();
    source.register('one', { ev } as unknown as WASocket);
    ev.emit('messages.upsert', { messages: [first], type: 'notify' });
    await vi.waitFor(() => expect(handle).toHaveBeenCalledOnce());
    let stopped = false;
    const closing = receiver.onModuleDestroy().then(() => {
      stopped = true;
    });
    try {
      await Promise.resolve();
      expect(stopped).toBe(false);
      ev.emit('messages.upsert', { messages: [second], type: 'notify' });
      expect(handle).toHaveBeenCalledOnce();
    } finally {
      release();
      await closing;
    }
    expect(stopped).toBe(true);
  });
});
