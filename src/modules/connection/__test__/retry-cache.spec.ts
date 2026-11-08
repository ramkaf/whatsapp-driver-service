import { RetryCache } from '../providers/socket/retry-cache.ts';

describe('RetryCache', () => {
  afterEach(() => vi.useRealTimers());

  it('expires entries at the TTL boundary and refreshes overwritten values', () => {
    vi.useFakeTimers();
    const cache = new RetryCache();
    cache.set('old', 1);
    cache.set('refresh', 2);
    vi.advanceTimersByTime(100);
    cache.set('refresh', 3);
    vi.advanceTimersByTime(299900);
    expect(cache.get('old')).toBeUndefined();
    expect(cache.get('refresh')).toBe(3);
    vi.advanceTimersByTime(100);
    expect(cache.get('refresh')).toBeUndefined();
  });

  it('evicts the oldest entry at capacity and keeps caches isolated', () => {
    const cache = new RetryCache();
    for (let index = 0; index < 1000; index++) cache.set(String(index), index);
    cache.set('0', 'refreshed');
    cache.set('next', 1000);
    expect(cache.get('1')).toBeUndefined();
    expect(cache.get('0')).toBe('refreshed');
    expect(new RetryCache().get('0')).toBeUndefined();
    cache.del('0');
    expect(cache.get('0')).toBeUndefined();
    cache.flushAll();
    expect(cache.get('next')).toBeUndefined();
  });
});
