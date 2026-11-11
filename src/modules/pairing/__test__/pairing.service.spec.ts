import { describe, expect, it, vi } from 'vitest';
import { PairingService } from '../providers/pairing.service.ts';
import type { SessionManagerService } from '../../connection/providers/session/session-manager.service.ts';
import type { IWaSessionRepository } from '@libs/prisma';

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
      repository as unknown as IWaSessionRepository,
    ),
  };
}

describe('PairingService', () => {
  it('normalizes the phone and single-flights simultaneous pairing code requests', async () => {
    const { service, manager } = fixture();
    const results = await Promise.all([
      service.requestPairingCode('one', '+98 912 123 4567'),
      service.requestPairingCode('one', '+989121234567'),
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
    await expect(service.requestPairingCode('one', '123')).rejects.toThrow(
      'valid international',
    );
    expect(manager.preparePairing).not.toHaveBeenCalled();
  });
  it('uses the stored phone when the code request omits it', async () => {
    const { service, manager } = fixture();
    await service.requestPairingCode('one');
    expect(manager.requestPairingCode).toHaveBeenCalledWith(
      'one',
      '989121234567',
    );
  });
  it('rejects a code request when no phone is supplied or stored', async () => {
    const { service, repository, manager } = fixture();
    repository.require.mockResolvedValueOnce({
      phone: null,
      pairingMethod: 'QR',
    });
    await expect(service.requestPairingCode('one')).rejects.toThrow(
      'phone number is required',
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
  it('starts QR pairing without a phone or generating a pairing code', async () => {
    const { service, repository, manager } = fixture();
    repository.require.mockResolvedValueOnce({
      phone: null,
      pairingMethod: 'QR',
    });

    const result = await service.startQr('one');

    expect(manager.preparePairing).toHaveBeenCalledWith('one', 'QR');
    expect(manager.requestPairingCode).not.toHaveBeenCalled();
    expect(result).toMatchObject({
      sessionId: 'one',
      pairingMethod: 'QR',
      qr: 'secret-qr',
    });
  });
  it('blocks QR until the pending pairing code request finishes', async () => {
    const { service, manager } = fixture();
    let finish!: (result: { code: string; expiresAt: string }) => void;
    let markStarted!: () => void;
    const started = new Promise<void>((resolve) => {
      markStarted = resolve;
    });
    manager.requestPairingCode.mockImplementationOnce(() => {
      markStarted();
      return new Promise((resolve) => {
        finish = resolve;
      });
    });
    const code = service.requestPairingCode('one');
    await started;

    await expect(service.startQr('one')).rejects.toThrow(
      'pairing code request is in progress',
    );
    expect(manager.preparePairing).toHaveBeenCalledTimes(1);
    expect(manager.pairing).not.toHaveBeenCalled();

    finish({ code: 'secret-code', expiresAt: '2026-11-08T18:00:00Z' });
    await code;
    await service.startQr('one');
    expect(manager.preparePairing).toHaveBeenLastCalledWith('one', 'QR');
  });
});
