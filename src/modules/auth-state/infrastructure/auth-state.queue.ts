export class AuthStateQueue {
  private tail: Promise<void> = Promise.resolve();

  private failure: unknown = null;

  private closed = false;

  constructor(private readonly onFailure: (error: unknown) => void) {}

  run<T>(operation: () => Promise<T>): Promise<T> {
    if (this.closed) {
      return Promise.reject(new Error('Authentication store is closed'));
    }

    const task = this.tail.then(async () => {
      if (this.failure !== null) {
        throw this.failure;
      }

      return operation();
    });

    this.tail = task.then(
      () => undefined,
      (error: unknown) => {
        if (this.failure === null) {
          this.failure = error;

          try {
            this.onFailure(error);
          } catch {
            // Do not allow failure notification
            // to break queue synchronization.
          }
        }
      },
    );

    return task;
  }

  async flush(): Promise<void> {
    await this.tail;

    if (this.failure !== null) {
      throw this.failure;
    }
  }

  async close(): Promise<void> {
    if (this.closed) {
      await this.flush();
      return;
    }

    this.closed = true;

    await this.flush();
  }

  get isClosed(): boolean {
    return this.closed;
  }

  get hasFailed(): boolean {
    return this.failure !== null;
  }
}
