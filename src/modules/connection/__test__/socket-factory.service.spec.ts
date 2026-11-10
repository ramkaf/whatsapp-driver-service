import type { AuthenticationState, WASocket } from '@whiskeysockets/baileys';
import makeWASocket from '@whiskeysockets/baileys';
import { SocketFactoryService } from '../providers/socket/socket-factory.service.ts';
import type { SocketEventRegistrarService } from '../providers/socket/socket-event-registrar.service.ts';

vi.mock('@whiskeysockets/baileys', () => ({
  default: vi.fn(),
  Browsers: { ubuntu: vi.fn(() => ['Ubuntu', 'Chrome', '1']) },
}));

describe('SocketFactoryService', () => {
  it('preserves socket settings and allocates a separate retry cache for each session', () => {
    const socket = {} as WASocket;
    vi.mocked(makeWASocket).mockReturnValue(socket);
    const register = vi.fn();
    const service = new SocketFactoryService({
      register,
    } as unknown as SocketEventRegistrarService);
    const auth = {} as AuthenticationState;
    expect(service.create('one', auth, 1234)).toBe(socket);
    service.create('two', auth, 5678);
    const first = vi.mocked(makeWASocket).mock.calls[0]![0];
    const second = vi.mocked(makeWASocket).mock.calls[1]![0];
    expect(first).toMatchObject({
      auth,
      qrTimeout: 1234,
      syncFullHistory: false,
      markOnlineOnConnect: false,
      keepAliveIntervalMs: 25000,
      connectTimeoutMs: 60000,
    });
    expect(first.msgRetryCounterCache).not.toBe(second.msgRetryCounterCache);
    expect(register.mock.calls).toEqual([
      ['one', socket, expect.any(Function)],
      ['two', socket, expect.any(Function)],
    ]);
  });
});
