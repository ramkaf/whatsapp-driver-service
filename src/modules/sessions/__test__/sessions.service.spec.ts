import { describe, expect, it, vi } from 'vitest';
import { SessionsService } from '../providers/sessions.service.ts';
import type { IAppConfig } from '@libs/common';
import type { IWaSessionRepository } from '@libs/prisma';
import type { SessionManagerService } from '../../connection/providers/session/session-manager.service.ts';
import { PairingMethodEnum } from '../interfaces/session.interface.ts';

function fixture(max = 50) {
  const rows: Record<string, unknown>[] = [];
  const repository = {
    create: vi.fn(async (data: object) => {
      const row = { id: `session-${rows.length}`, ...data };
      rows.push(row);
      return row;
    }),
    require: vi.fn(async () => rows.at(-1)),
  };
  const manager = {
    replace: vi.fn(async (data: object) => repository.create(data)),
    snapshot: vi.fn().mockReturnValue({ status: 'CONNECTING' }),
  };
  return {
    repository,
    manager,
    service: new SessionsService(
      repository as unknown as IWaSessionRepository,
      manager as unknown as SessionManagerService,
      { whatsapp: { maxSessions: max } } as IAppConfig,
    ),
  };
}

describe('SessionsService', () => {
  it('creates a session with normalized phone and starts its lifecycle', async () => {
    const { service, repository, manager } = fixture();
    const result = await service.create({
      name: 'WhatsApp 01',
      phone: '+98 912 123 4567',
      pairingMethod: PairingMethodEnum.CODE,
    });
    expect(manager.replace).toHaveBeenCalledWith(
      {
        name: 'WhatsApp 01',
        phone: '989121234567',
        pairingMethod: 'CODE',
      },
      50,
    );
    expect(repository.require).toHaveBeenCalledWith(result.id);
    expect(result.runtime.status).toBe('CONNECTING');
  });
  it('serializes concurrent creation commands', async () => {
    const { service, repository, manager } = fixture(1);
    let active = 0;
    let peak = 0;
    manager.replace.mockImplementation(async (data: object) => {
      active++;
      peak = Math.max(peak, active);
      await Promise.resolve();
      const result = await repository.create(data);
      active--;
      return result;
    });
    const results = await Promise.allSettled([
      service.create({
        name: 'one',
        phone: '989121234567',
        pairingMethod: PairingMethodEnum.QR,
      }),
      service.create({
        name: 'two',
        phone: '989131234567',
        pairingMethod: PairingMethodEnum.QR,
      }),
    ]);
    expect(results.map((result) => result.status)).toEqual([
      'fulfilled',
      'fulfilled',
    ]);
    expect(repository.create).toHaveBeenCalledTimes(2);
    expect(peak).toBe(1);
  });
});
