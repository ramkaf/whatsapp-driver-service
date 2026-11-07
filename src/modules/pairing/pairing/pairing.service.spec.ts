import { describe, expect, it, vi } from 'vitest';
import { PairingService } from './pairing.service.ts';
import type { SessionManagerService } from '../../connection/session-manager/session-manager.service.ts';
import type { SessionRepository } from '../../sessions/session.repository.ts';

function fixture() {
  const repository = {
    require: vi
      .fn()
      .mockResolvedValue({ phone: '989121234567', pairingMethod: 'QR' }),
  };
  const manager = {
    preparePairing: vi.fn().mockResolvedValue(undefined),
    requestPairingCode: vi.fn().mockResolvedValue({
      code: 'secret-code',
      expiresAt: '2026-11-04T18:00:00Z',
    }),
    snapshot: vi.fn().mockReturnValue({ status: 'AWAITING_PAIRING' }),
    pairing: vi.fn().mockReturnValue({ qr: 'secret-qr', expiresAt: null }),
  };
  return {
    repository,
    manager,
    service: new PairingService(
      manager as unknown as SessionManagerService,
      repository as unknown as SessionRepository,
    ),
  };
}

describe('PairingService', () => {
  it('normalizes the phone and single-flights simultaneous pairing code requests', async () => {
    const { service, manager } = fixture();
    const results = await Promise.all([
      service.code('one', '+98 912 123 4567'),
      service.code('one', '+989121234567'),
    ]);
    expect(results[0]).toEqual(results[1]);
    expect(manager.preparePairing).toHaveBeenCalledWith(
      'one',
      'CODE',
      '989121234567',
    );
    expect(manager.requestPairingCode).toHaveBeenCalledOnce();
  });
  it('rejects invalid phone numbers before starting pairing', async () => {
    const { service, manager } = fixture();
    await expect(service.code('one', '123')).rejects.toThrow(
      'valid international',
    );
    expect(manager.preparePairing).not.toHaveBeenCalled();
  });
  it('reads QR without restarting the session', async () => {
    const { service, manager } = fixture();
    await service.qr('one');
    await service.qr('one');
    expect(manager.preparePairing).not.toHaveBeenCalled();
    expect(manager.pairing).toHaveBeenCalledWith('one');
  });
});
