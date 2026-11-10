import type { Headers } from '../type/headers.type.ts';

export interface TraceAdapter {
  captureError?(error: unknown): void;
  inject(headers?: Headers): Headers;
  run<T>(name: string, headers: Headers, handler: () => Promise<T>): Promise<T>;
}
