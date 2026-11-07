import type { IAppConfig } from '@libs/common';
import { ConnectionSupervisorService } from '../providers/recovery/connection-supervisor.service.ts';

describe('ConnectionSupervisorService', () => {
  const service = new ConnectionSupervisorService({
    whatsapp: { maxRetries: 20 },
  } as IAppConfig);
  afterEach(() => vi.restoreAllMocks());

  it('bounds normal and restart retries at the configured threshold', () => {
    expect(service.next(20)).toBeNull();
    expect(service.next(20, true)).toBeNull();
    expect(service.next(19, true)).toBe(250);
  });

  it('applies exponential backoff, jitter and the delay ceiling', () => {
    vi.spyOn(Math, 'random').mockReturnValue(0);
    expect(service.next(0)).toBe(500);
    expect(service.next(1)).toBe(1000);
    expect(service.next(19)).toBe(30000);
    vi.mocked(Math.random).mockReturnValue(0.999);
    expect(service.next(19)).toBeLessThanOrEqual(60000);
  });
});
