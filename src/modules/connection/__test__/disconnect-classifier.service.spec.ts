import { DisconnectReason } from '@whiskeysockets/baileys';
import { DisconnectClassifierService } from '../providers/disconnect/disconnect-classifier.service.ts';

describe('disconnect classification', () => {
  const handler = new DisconnectClassifierService();
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
      expect(handler.classify(update(code).lastDisconnect.error)).toEqual({
        code,
        action,
        reason,
      });
    },
  );

  it('distinguishes exhausted QR attempts from a network timeout with the same code', () => {
    expect(
      handler.classify(
        update(408, 'QR refs attempts ended').lastDisconnect.error,
      ),
    ).toMatchObject({ action: 'expired', reason: 'QR_EXPIRED' });
    expect(handler.classify(update(408).lastDisconnect.error)).toMatchObject({
      action: 'retry',
      reason: 'TIMEOUT_OR_CONNECTION_LOST',
    });
    expect(
      handler.classify(
        update(503, 'QR refs attempts ended').lastDisconnect.error,
      ),
    ).toMatchObject({ action: 'retry', reason: 'SERVICE_UNAVAILABLE' });
  });
  it.each([
    undefined,
    null,
    'error',
    {},
    { output: null },
    { output: { statusCode: '401' } },
    { output: { statusCode: NaN } },
  ])('uses the unknown-close fallback for malformed errors: %s', (error) => {
    expect(handler.classify(error)).toEqual({
      code: null,
      action: 'retry',
      reason: 'UNKNOWN_CLOSE',
    });
  });
});
