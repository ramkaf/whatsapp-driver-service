import type { SessionsService } from '../../sessions/providers/sessions.service.ts';
import { HealthController } from '../controllers/health.controller.ts';

describe('HealthController', () => {
  const session = (
    status: string,
    connected = false,
    persistedStatus = status,
  ) => ({
    status: persistedStatus,
    runtime: { status, connected },
  });

  function fixture() {
    const list = vi.fn().mockResolvedValue([]);
    return {
      list,
      controller: new HealthController({ list } as unknown as SessionsService),
    };
  }

  it('reports healthy with zero sessions', async () => {
    const { controller } = fixture();
    await expect(controller.health()).resolves.toEqual({
      status: 'ok',
      uptimeSeconds: expect.any(Number),
      sessions: {
        total: 0,
        connected: 0,
        disconnected: 0,
        reconnecting: 0,
        failed: 0,
        pairing: 0,
      },
    });
  });

  it('counts runtime and persisted failures separately from reconnecting and pairing sessions', async () => {
    const { list, controller } = fixture();
    list.mockResolvedValue([
      session('CONNECTED', true),
      session('DISCONNECTED'),
      session('CONNECTING'),
      session('RECONNECTING'),
      session('FAILED'),
      session('DISCONNECTED', false, 'FAILED'),
      session('AWAITING_PAIRING'),
      session('AUTHENTICATING'),
    ]);
    const result = await controller.health();
    expect(result.status).toBe('degraded');
    expect(result.sessions).toEqual({
      total: 8,
      connected: 1,
      disconnected: 1,
      reconnecting: 2,
      failed: 2,
      pairing: 2,
    });
  });

  it('does not report a healthy result when session persistence is unavailable', async () => {
    const { list, controller } = fixture();
    const failure = new Error('database unavailable');
    list.mockRejectedValueOnce(failure);
    await expect(controller.health()).rejects.toBe(failure);
  });
});
