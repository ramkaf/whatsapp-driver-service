/** Serializes work per key without retaining idle sessions or poisoning the queue. */
export class SessionQueue {
  private readonly pending = new Map<string, Promise<unknown>>();

  run<T>(key: string, work: () => Promise<T>): Promise<T> {
    const previous = this.pending.get(key) ?? Promise.resolve();
    const next = previous.catch(() => undefined).then(work);
    this.pending.set(key, next);
    void next
      .finally(() => {
        if (this.pending.get(key) === next) this.pending.delete(key);
      })
      .catch(() => undefined);
    return next;
  }

  async drain(): Promise<void> {
    await Promise.allSettled(this.pending.values());
  }
}
