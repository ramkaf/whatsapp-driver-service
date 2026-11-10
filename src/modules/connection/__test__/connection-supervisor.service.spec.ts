import { ConnectionSupervisorService } from '../providers/recovery/connection-supervisor.service.ts';

describe('ConnectionSupervisorService', () => {
  const service = new ConnectionSupervisorService();
  afterEach(() => vi.restoreAllMocks());

  it('only fast-tracks the first protocol restart', () => {
    vi.spyOn(Math, 'random').mockReturnValue(0);
    expect(service.next(0, true)).toBe(250);
    expect(service.next(1, true)).toBe(1000);
    expect(service.next(20, true)).toBe(30000);
  });

  it.each([10, 20, 1000, Number.MAX_SAFE_INTEGER])(
    'continues retrying with a finite capped delay after %s failures',
    (retries) => {
      for (const restartRequired of [false, true]) {
        const delay = service.next(retries, restartRequired);
        expect(Number.isFinite(delay)).toBe(true);
        expect(delay).toBeGreaterThanOrEqual(30000);
        expect(delay).toBeLessThanOrEqual(60000);
      }
    },
  );

  it('applies exponential backoff, jitter and the delay ceiling', () => {
    vi.spyOn(Math, 'random').mockReturnValue(0);
    expect(service.next(0)).toBe(500);
    expect(service.next(1)).toBe(1000);
    expect(service.next(19)).toBe(30000);
    vi.mocked(Math.random).mockReturnValue(0.999);
    expect(service.next(19)).toBeLessThanOrEqual(60000);
  });
});
