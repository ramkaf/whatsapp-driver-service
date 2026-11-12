import type { ClientRequest, IncomingMessage } from 'node:http';
import type * as Http from 'node:http';
import { Agent, Dispatcher1Wrapper } from 'undici';
import type { Dispatcher } from 'undici';

export const MEDIA_NETWORK_TIMEOUT_MS = 120_000;

export function createMediaTimeoutError(timeoutMs: number): Error {
  return Object.assign(
    new Error(`Media request timed out after ${timeoutMs}ms`),
    { code: 'MEDIA_REQUEST_TIMEOUT' },
  );
}

/** Bound DNS, connection, headers AND response bodies, including active traffic. */
export function createTimeoutTransport(
  transport: Pick<typeof Http, 'request'>,
  timeoutMs = MEDIA_NETWORK_TIMEOUT_MS,
): Pick<typeof Http, 'request'> {
  return {
    request: ((...args: unknown[]) => {
      const request = Reflect.apply(
        transport.request,
        transport,
        args,
      ) as ClientRequest;
      let response: IncomingMessage | undefined;
      const timer = setTimeout(() => {
        const error = createMediaTimeoutError(timeoutMs);
        response?.destroy(error);
        request.destroy(error);
      }, timeoutMs);
      timer.unref();
      const clearDeadline = () => clearTimeout(timer);
      request.once('response', (incoming) => {
        response = incoming;
        incoming.once('end', clearDeadline);
        incoming.once('close', clearDeadline);
      });
      request.once('error', clearDeadline);
      request.once('close', () => {
        // A finished request does not necessarily mean its response body ended.
        if (!response || response.complete || response.destroyed)
          clearDeadline();
      });
      return request;
    }) as typeof Http.request,
  };
}

/** Baileys pipes a hidden fetch source without forwarding its errors. */
export function createDownloadErrorInterceptor(
  controller: AbortController,
): Dispatcher.DispatchInterceptor {
  return (dispatch) => (options, handler) => {
    let receivedHeaders = false;
    let terminal = false;
    return dispatch(options, {
      onRequestStart: handler.onRequestStart?.bind(handler),
      onRequestUpgrade: handler.onRequestUpgrade?.bind(handler),
      onResponseStarted: handler.onResponseStarted?.bind(handler),
      onResponseData(control, chunk) {
        if (!terminal) handler.onResponseData?.(control, chunk);
      },
      onResponseEnd(control, trailers) {
        if (terminal) return;
        terminal = true;
        handler.onResponseEnd?.(control, trailers);
      },
      onBodySent: handler.onBodySent?.bind(handler),
      onRequestSent: handler.onRequestSent?.bind(handler),
      onResponseStart(...args) {
        receivedHeaders ||= args[1] >= 200;
        handler.onResponseStart?.(...args);
      },
      onResponseError(control, error) {
        if (terminal) return;
        terminal = true;
        controller.abort(error);
        if (receivedHeaders) {
          // The outer pipeline is already aborted. End the hidden source cleanly
          // so it cannot emit an unhandled error or leave a live fetch socket.
          handler.onResponseEnd?.(control, {});
        } else {
          handler.onResponseError?.(control, error);
        }
      },
    });
  };
}

export function createDownloadDeadline(timeoutMs = MEDIA_NETWORK_TIMEOUT_MS) {
  const controller = new AbortController();
  // Node 24 and 26 expose different native fetch dispatcher handler versions.
  const dispatcher = new Dispatcher1Wrapper(
    new Agent({
      headersTimeout: timeoutMs,
      bodyTimeout: timeoutMs,
      connect: { timeout: timeoutMs },
    }).compose(createDownloadErrorInterceptor(controller)),
  );
  const timer = setTimeout(() => {
    const error = createMediaTimeoutError(timeoutMs);
    controller.abort(error);
    void dispatcher.destroy(error).catch(() => undefined);
  }, timeoutMs);
  timer.unref();

  return {
    signal: controller.signal,
    dispatcher,
    async dispose() {
      clearTimeout(timer);
      await dispatcher.destroy().catch(() => undefined);
    },
  };
}

/** Also bounds socket reupload callbacks, which do not accept AbortSignal. */
export function abortable<T>(
  work: Promise<T>,
  signal: AbortSignal,
): Promise<T> {
  return new Promise((resolve, reject) => {
    const aborted = () => reject(signal.reason);
    signal.addEventListener('abort', aborted, { once: true });
    void work.then(resolve, reject).finally(() => {
      signal.removeEventListener('abort', aborted);
    });
    if (signal.aborted) aborted();
  });
}
