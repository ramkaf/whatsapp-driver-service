import { Injectable } from '@nestjs/common';
import type { SessionRuntime } from '../../interfaces/session-runtime.ts';

// Fences stale events and releases socket resources while flushing authentication writes.
@Injectable()
export class SocketLifecycleService {
  cancelRetry(runtime: SessionRuntime): void {
    if (runtime.reconnectTimer) clearTimeout(runtime.reconnectTimer);
    runtime.reconnectTimer = null;
    runtime.nextRetryAt = null;
  }

  async teardown(runtime: SessionRuntime): Promise<void> {
    this.cancelRetry(runtime);
    runtime.generation++;
    runtime.dispose?.();
    runtime.dispose = null;
    const socket = runtime.socket;
    const auth = runtime.auth;
    runtime.socket = null;
    runtime.auth = null;
    runtime.qr = null;
    runtime.code = null;
    runtime.pairingReady = false;
    runtime.connectedAt = null;
    const errors: unknown[] = [];
    try {
      await socket?.end(undefined);
    } catch (error) {
      errors.push(error);
    }
    try {
      await auth?.close();
    } catch (error) {
      errors.push(error);
    }
    if (errors.length)
      throw new AggregateError(
        errors,
        'Socket or authentication cleanup failed',
      );
  }
}
