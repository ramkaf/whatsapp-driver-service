import type { CacheStore } from '@whiskeysockets/baileys';

// Bounds message retry state by capacity and expiration time.
export class RetryCache implements CacheStore {
  private readonly values = new Map<
    string,
    { value: unknown; expires: number }
  >();
  get<T>(key: string): T | undefined {
    const entry = this.values.get(key);
    if (!entry) return undefined;
    if (entry.expires <= Date.now()) {
      this.values.delete(key);
      return undefined;
    }
    return entry.value as T;
  }
  set<T>(key: string, value: T): void {
    this.values.delete(key);
    if (this.values.size >= 1000)
      this.values.delete(this.values.keys().next().value!);
    this.values.set(key, { value, expires: Date.now() + 300000 });
  }
  del(key: string): void {
    this.values.delete(key);
  }
  flushAll(): void {
    this.values.clear();
  }
}
