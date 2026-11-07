import { describe, expect, it, vi } from 'vitest';
import { SessionsService } from '../providers/sessions.service.ts';
import type { IAppConfig } from '@libs/common';
import type { SessionRepository } from '../session.repository.ts';
import type { SessionManagerService } from '../../connection/providers/session-manager.service.ts';

function fixture(max = 50) {
  const rows: Record<string, unknown>[] = [];
  const repository = {
    count: vi.fn(async () => rows.length),
    create: vi.fn(async (data: object) => {
      const row = { id: `session-${rows.length}`, ...data };
      rows.push(row);
      return row;
    }),
    require: vi.fn(async () => rows.at(-1)),
  };
  const manager = {
    start: vi.fn().mockResolvedValue(undefined),
    snapshot: vi.fn().mockReturnValue({ status: 'CONNECTING' }),
  };
  return {
    repository,
    manager,
    service: new SessionsService(
      repository as unknown as SessionRepository,
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
      pairingMethod: 'CODE',
    });
    expect(repository.create).toHaveBeenCalledWith({
      name: 'WhatsApp 01',
      phone: '989121234567',
      pairingMethod: 'CODE',
    });
    expect(manager.start).toHaveBeenCalledWith(result.id);
    expect(result.runtime.status).toBe('CONNECTING');
  });
  it('enforces the process session limit under concurrent creates', async () => {
    const { service, repository } = fixture(1);
    const results = await Promise.allSettled([
      service.create({ name: 'one', pairingMethod: 'QR' }),
      service.create({ name: 'two', pairingMethod: 'QR' }),
    ]);
    expect(results.map((result) => result.status)).toEqual([
      'fulfilled',
      'rejected',
    ]);
    expect(repository.create).toHaveBeenCalledOnce();
  });
});
