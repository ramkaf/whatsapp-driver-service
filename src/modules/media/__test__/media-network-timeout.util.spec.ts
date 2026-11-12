import { EventEmitter } from 'node:events';
import type * as Http from 'node:http';
import { PassThrough, Writable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { setImmediate } from 'node:timers/promises';
import { downloadMediaMessage } from '@whiskeysockets/baileys';
import { pino } from 'pino';
import { Dispatcher1Wrapper } from 'undici';
import type { Dispatcher } from 'undici';
import {
  abortable,
  createDownloadErrorInterceptor,
  createTimeoutTransport,
} from '../utils/media-network-timeout.util.ts';

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe('media HTTP request deadline', () => {
  function fixture() {
    const request = Object.assign(new EventEmitter(), {
      destroy: vi.fn((error) => {
        request.emit('error', error);
        request.emit('close');
      }),
    });
    const underlying = {
      request: vi
        .fn()
        .mockReturnValue(request) as unknown as typeof Http.request,
    };
    createTimeoutTransport(underlying, 100).request({
      hostname: 'test.invalid',
    });
    return request;
  }

  it('destroys requests stalled during DNS, connect or response headers', async () => {
    vi.useFakeTimers();
    const request = fixture();
    await vi.advanceTimersByTimeAsync(100);
    expect(request.destroy).toHaveBeenCalledExactlyOnceWith(
      expect.objectContaining({ code: 'MEDIA_REQUEST_TIMEOUT' }),
    );
  });

  it('keeps the deadline through the response body even if the request closes first', async () => {
    vi.useFakeTimers();
    const request = fixture();
    const response = new PassThrough();
    const error = vi.fn();
    response.on('error', error);
    request.emit('response', response);
    request.emit('close');
    await vi.advanceTimersByTimeAsync(100);
    expect(request.destroy).toHaveBeenCalledOnce();
    expect(response.destroyed).toBe(true);
    expect(error).toHaveBeenCalledWith(
      expect.objectContaining({ code: 'MEDIA_REQUEST_TIMEOUT' }),
    );
  });

  it.each(['end', 'close'])(
    'clears the timer when the response emits %s',
    async (event) => {
      vi.useFakeTimers();
      const request = fixture();
      const response = new PassThrough();
      request.emit('response', response);
      response.emit(event);
      await vi.advanceTimersByTimeAsync(101);
      expect(request.destroy).not.toHaveBeenCalled();
      response.destroy();
    },
  );
});

describe('Baileys download error adapter', () => {
  const control: Dispatcher.DispatchController = {
    aborted: false,
    paused: false,
    reason: null,
    abort() {},
    pause() {},
    resume() {},
  };
  function fixture() {
    const controller = new AbortController();
    const handler = {
      onResponseStart: vi.fn().mockReturnValue(true),
      onResponseEnd: vi.fn(),
      onResponseError: vi.fn(),
      onResponseData: vi.fn().mockReturnValue(true),
    };
    let intercepted: Dispatcher.DispatchHandler;
    const dispatch = vi.fn((_options, value) => {
      intercepted = value;
      return true;
    });
    createDownloadErrorInterceptor(controller)(dispatch)(
      { origin: 'https://test.invalid', path: '/', method: 'GET' },
      handler,
    );
    return { controller, handler, intercepted: intercepted! };
  }

  it('rejects errors before headers through fetch without creating a body stream', () => {
    const f = fixture();
    const error = Object.assign(new Error('connection failed'), {
      code: 'ECONNRESET',
    });
    f.intercepted.onResponseError!(control, error);
    expect(f.handler.onResponseError).toHaveBeenCalledExactlyOnceWith(
      control,
      error,
    );
    expect(f.handler.onResponseEnd).not.toHaveBeenCalled();
    expect(f.controller.signal.reason).toBe(error);
  });

  it('aborts the outer pipeline but cleanly ends Baileys hidden body on a network error', () => {
    const f = fixture();
    const error = Object.assign(new Error('response interrupted'), {
      code: 'ECONNRESET',
    });
    f.intercepted.onResponseStart!(control, 200, {}, 'OK');
    f.intercepted.onResponseError!(control, error);
    f.intercepted.onResponseError!(control, error);
    f.intercepted.onResponseEnd!(control, {});
    f.intercepted.onResponseData!(control, Buffer.from('late bytes'));
    expect(f.controller.signal.reason).toBe(error);
    expect(f.handler.onResponseEnd).toHaveBeenCalledExactlyOnceWith(
      control,
      {},
    );
    expect(f.handler.onResponseError).not.toHaveBeenCalled();
    expect(f.handler.onResponseData).not.toHaveBeenCalled();
  });

  it('bounds a hung reupload callback and handles its eventual rejection', async () => {
    const controller = new AbortController();
    let rejectWork: (error: Error) => void;
    const work = new Promise<never>((_resolve, reject) => {
      rejectWork = reject;
    });
    const result = abortable(work, controller.signal);
    const error = new Error('deadline');
    controller.abort(error);
    await expect(result).rejects.toBe(error);
    rejectWork!(new Error('late socket failure'));
    await Promise.resolve();
  });

  it('handles work rejection when its signal was already aborted', async () => {
    const controller = new AbortController();
    const reason = new Error('deadline');
    controller.abort(reason);
    const work = Promise.reject(new Error('late socket failure'));
    await expect(abortable(work, controller.signal)).rejects.toBe(reason);
  });

  it('bridges legacy Node 24 fetch handlers using the SDK compatibility wrapper', () => {
    const controller = new AbortController();
    let intercepted: Dispatcher.DispatchHandler | undefined;
    const dispatch = createDownloadErrorInterceptor(controller)((
      _options,
      handler,
    ) => {
      intercepted = handler;
      return true;
    });
    const dispatcher = new Dispatcher1Wrapper({ dispatch } as Dispatcher);
    const legacy = {
      onConnect: vi.fn(),
      onHeaders: vi.fn().mockReturnValue(true),
      onData: vi.fn().mockReturnValue(true),
      onComplete: vi.fn(),
      onError: vi.fn(),
    };
    // Legacy handlers intentionally precede the modern public TypeScript API.
    Reflect.apply(dispatcher.dispatch, dispatcher, [
      { origin: 'https://test.invalid', path: '/', method: 'GET' },
      legacy,
    ]);
    intercepted!.onRequestStart!(control, {});
    intercepted!.onResponseStart!(control, 200, {}, 'OK');
    const error = new Error('response interrupted');
    intercepted!.onResponseError!(control, error);
    expect(legacy.onConnect).toHaveBeenCalledOnce();
    expect(legacy.onHeaders).toHaveBeenCalledWith(
      200,
      [],
      expect.any(Function),
      'OK',
    );
    expect(legacy.onComplete).toHaveBeenCalledExactlyOnceWith([]);
    expect(legacy.onError).not.toHaveBeenCalled();
    expect(controller.signal.reason).toBe(error);
  });

  it('handles actual Baileys hidden fetch streams without unhandled errors on body disconnect', async () => {
    const controller = new AbortController();
    let activeHandler: Dispatcher.DispatchHandler | undefined;
    const dispatch = createDownloadErrorInterceptor(controller)((
      _options,
      handler,
    ) => {
      activeHandler = handler;
      handler.onRequestStart?.(control, {});
      queueMicrotask(() => handler.onResponseStart?.(control, 200, {}, 'OK'));
      return true;
    });
    const options = { dispatcher: { dispatch }, signal: controller.signal };
    // Native fetch uses the supplied offline dispatcher; no socket is opened.
    const decrypted = await downloadMediaMessage(
      {
        key: { remoteJid: 'chat@s.whatsapp.net', id: 'message' },
        message: {
          imageMessage: {
            url: 'https://test.invalid/media',
            mediaKey: Buffer.alloc(32),
          },
        },
      },
      'stream',
      { options },
      { logger: pino({ level: 'silent' }), reuploadRequest: vi.fn() },
    );
    const consume = pipeline(
      decrypted,
      new Writable({
        write(_chunk, _encoding, callback) {
          callback();
        },
      }),
      { signal: controller.signal },
    );
    const rejected = expect(consume).rejects.toMatchObject({
      code: 'ABORT_ERR',
    });
    const error = Object.assign(new Error('connection interrupted'), {
      code: 'ECONNRESET',
    });
    activeHandler!.onResponseError!(control, error);
    await rejected;
    await setImmediate();
    expect(controller.signal.reason).toBe(error);
    expect(decrypted.destroyed).toBe(true);
  });
});
