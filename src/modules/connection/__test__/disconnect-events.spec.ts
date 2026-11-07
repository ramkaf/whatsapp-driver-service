import { DisconnectReason } from '@whiskeysockets/baileys';
import { DisconnectErrorParser } from '../providers/events/disconnect-error.parser.ts';
import { DisconnectClassifierService } from '../providers/events/disconnect-classifier.service.ts';

describe('DisconnectErrorParser', () => {
  const parser = new DisconnectErrorParser();
  it.each([
    undefined,
    null,
    'error',
    42,
    {},
    { output: null },
    { output: 'invalid' },
    { output: {} },
    { output: { statusCode: '401' } },
    { output: { statusCode: NaN } },
    { output: { statusCode: Infinity } },
  ])('rejects invalid status codes: %j', (error) => {
    expect(parser.parse(error)).toEqual({ code: null, message: null });
  });
  it.each([new Error('closed'), { message: 'closed' }])(
    'parses error messages: %j',
    (error) => {
      expect(parser.parse(error)).toEqual({ code: null, message: 'closed' });
    },
  );
  it('accepts finite unknown codes but does not coerce non-string messages', () => {
    expect(parser.parse({ output: { statusCode: 999 }, message: 123 })).toEqual(
      { code: 999, message: null },
    );
  });
});

describe('events DisconnectClassifierService', () => {
  const classifier = new DisconnectClassifierService();
  it.each([
    [401, 'logout', 'LOGGED_OUT'],
    [440, 'replaced', 'CONNECTION_REPLACED'],
    [500, 'invalid', 'INVALID_SESSION'],
    [411, 'invalid', 'MULTIDEVICE_MISMATCH'],
    [403, 'invalid', 'FORBIDDEN'],
    [515, 'restart', 'RESTART_REQUIRED'],
    [428, 'retry', 'SOCKET_CLOSED'],
    [408, 'retry', 'TIMEOUT_OR_CONNECTION_LOST'],
    [503, 'retry', 'SERVICE_UNAVAILABLE'],
    [999, 'retry', 'UNKNOWN_CLOSE'],
  ])('classifies code %i', (code, action, reason) => {
    expect(classifier.classify({ output: { statusCode: code } })).toEqual({
      code,
      action,
      reason,
    });
  });
  it('uses the safe fallback for missing errors', () => {
    expect(classifier.classify(undefined)).toEqual({
      code: null,
      action: 'retry',
      reason: 'UNKNOWN_CLOSE',
    });
  });
  it('only treats an exhausted QR timeout as pairing expiry', () => {
    expect(
      classifier.classify({
        output: { statusCode: DisconnectReason.timedOut },
        message: 'QR refs attempts ended',
      }),
    ).toEqual({ code: 408, action: 'expired', reason: 'QR_EXPIRED' });
    expect(
      classifier.classify({
        output: { statusCode: 503 },
        message: 'QR refs attempts ended',
      }),
    ).toMatchObject({ action: 'retry', reason: 'SERVICE_UNAVAILABLE' });
  });
});
