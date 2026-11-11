import type { WaSession } from '@database/client.js';
import type { WASocket } from '@whiskeysockets/baileys';
import type { AuthContext } from '../../auth-state/context/auth-state.context.ts';
import { SessionRuntimeService } from '../providers/session/session-runtime.service.ts';
import { SocketLifecycleService } from '../providers/socket/socket-lifecycle.service.ts';

describe('SocketLifecycleService', () => {
  const service = new SocketLifecycleService();
  const create = () =>
    new SessionRuntimeService().create({
      id: 'one',
      isEnabled: true,
    } as WaSession);
  afterEach(() => vi.useRealTimers());

  it('cancels retries, fences old events and clears secrets before ending the socket', async () => {
    vi.useFakeTimers();
    const runtime = create();
    const retry = vi.fn();
    runtime.reconnectTimer = setTimeout(() => {
      retry();
    }, 100);
    runtime.nextRetryAt = Date.now() + 100;
    runtime.qr = { value: 'secret', expiresAt: Date.now() + 100 };
    const dispose = vi.fn();
    runtime.dispose = dispose;
    const end = vi.fn(async () => {
      expect(runtime).toMatchObject({
        generation: 1,
        socket: null,
        auth: null,
        qr: null,
        nextRetryAt: null,
      });
      expect(dispose).toHaveBeenCalledOnce();
    });
    const close = vi.fn().mockResolvedValue(undefined);
    runtime.socket = { end } as unknown as WASocket;
    runtime.auth = { close } as unknown as AuthContext;
    await service.teardown(runtime);
    await vi.advanceTimersByTimeAsync(100);
    expect(retry).not.toHaveBeenCalled();
    expect(close).toHaveBeenCalledOnce();
    await service.teardown(runtime);
    expect(end).toHaveBeenCalledOnce();
  });

  it('still flushes authentication when socket shutdown fails and reports both errors', async () => {
    const runtime = create();
    const socketError = new Error('socket');
    const authError = new Error('auth');
    runtime.socket = {
      end: vi.fn().mockRejectedValue(socketError),
    } as unknown as WASocket;
    const close = vi.fn().mockRejectedValue(authError);
    runtime.auth = { close } as unknown as AuthContext;
    await expect(service.teardown(runtime)).rejects.toMatchObject({
      errors: [socketError, authError],
    });
    expect(close).toHaveBeenCalledOnce();
    expect(runtime.socket).toBeNull();
  });
});
