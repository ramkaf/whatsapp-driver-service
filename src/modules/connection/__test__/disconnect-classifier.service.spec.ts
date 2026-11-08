import { DisconnectReason } from '@whiskeysockets/baileys';
import { classifyDisconnect } from '../utils/disconnect-classifier.util.ts';

describe('disconnect classification', () => {
  function update(code: number, message = 'Connection closed') {
    return {
      connection: 'close' as const,
      lastDisconnect: {
        date: new Date(),
        error: Object.assign(new Error(message), {
          output: { statusCode: code },
        }),
      },
    };
  }

  it.each([
    [DisconnectReason.loggedOut, 'logout', 'LOGGED_OUT'],
    [DisconnectReason.connectionReplaced, 'replaced', 'CONNECTION_REPLACED'],
    [DisconnectReason.badSession, 'invalid', 'INVALID_SESSION'],
    [DisconnectReason.multideviceMismatch, 'invalid', 'MULTIDEVICE_MISMATCH'],
    [DisconnectReason.forbidden, 'invalid', 'FORBIDDEN'],
    [DisconnectReason.connectionClosed, 'retry', 'SOCKET_CLOSED'],
    [DisconnectReason.connectionLost, 'retry', 'TIMEOUT_OR_CONNECTION_LOST'],
    [DisconnectReason.timedOut, 'retry', 'TIMEOUT_OR_CONNECTION_LOST'],
    [DisconnectReason.restartRequired, 'restart', 'RESTART_REQUIRED'],
    [DisconnectReason.unavailableService, 'retry', 'SERVICE_UNAVAILABLE'],
    [999, 'retry', 'UNKNOWN_CLOSE'],
  ] as const)(
    'classifies code %s without guessing the underlying cause',
    (code, action, reason) => {
      expect(classifyDisconnect(update(code).lastDisconnect.error)).toEqual({
        code,
        action,
        reason,
      });
    },
  );

  it('distinguishes exhausted QR attempts from a network timeout with the same code', () => {
    expect(
      classifyDisconnect(
        update(408, 'QR refs attempts ended').lastDisconnect.error,
      ),
    ).toMatchObject({ action: 'expired', reason: 'QR_EXPIRED' });
    expect(classifyDisconnect(update(408).lastDisconnect.error)).toMatchObject({
      action: 'retry',
      reason: 'TIMEOUT_OR_CONNECTION_LOST',
    });
    expect(
      classifyDisconnect(
        update(503, 'QR refs attempts ended').lastDisconnect.error,
      ),
    ).toMatchObject({ action: 'retry', reason: 'SERVICE_UNAVAILABLE' });
  });
  it.each([
    undefined,
    null,
    'error',
    42,
    {},
    new Error('closed'),
    { message: 'closed' },
    { output: null },
    { output: 'invalid' },
    { output: {} },
    { output: { statusCode: '401' } },
    { output: { statusCode: NaN } },
    { output: { statusCode: Infinity } },
  ])('uses the unknown-close fallback for malformed errors: %s', (error) => {
    expect(classifyDisconnect(error)).toEqual({
      code: null,
      action: 'retry',
      reason: 'UNKNOWN_CLOSE',
    });
  });

  it.each([
    123,
    null,
    { toString: () => 'QR refs attempts ended' },
    ['QR refs attempts ended'],
  ])('does not coerce a non-string message into QR expiry: %j', (message) => {
    expect(
      classifyDisconnect({ output: { statusCode: 408 }, message }),
    ).toEqual({
      code: 408,
      action: 'retry',
      reason: 'TIMEOUT_OR_CONNECTION_LOST',
    });
  });
});
