import { ConnectionHandlerService } from '../providers/events/connection-handler.service.ts';
import { DisconnectClassifierService } from '../providers/disconnect/disconnect-classifier.service.ts';

describe('ConnectionHandlerService', () => {
  const classifier = new DisconnectClassifierService();
  const handler = new ConnectionHandlerService(classifier);

  afterEach(() => vi.restoreAllMocks());

  it('normalizes QR and authentication updates without classifying an open socket', () => {
    const classify = vi.spyOn(classifier, 'classify');
    expect(
      handler.process({ qr: 'qr', isNewLogin: true, connection: 'open' }),
    ).toEqual({
      qr: 'qr',
      authenticating: true,
      connection: 'open',
      disconnect: null,
    });
    expect(classify).not.toHaveBeenCalled();
  });

  it('classifies close events even when no disconnect error is available', () => {
    expect(handler.process({ connection: 'close' })).toMatchObject({
      authenticating: false,
      disconnect: { code: null, action: 'retry', reason: 'UNKNOWN_CLOSE' },
    });
  });

  it('passes the original error to the classifier', () => {
    const classify = vi.spyOn(classifier, 'classify');
    const error = Object.assign(new Error('closed'), {
      output: { statusCode: 401 },
    });
    expect(
      handler.process({
        connection: 'close',
        lastDisconnect: { error, date: new Date() },
      }).disconnect,
    ).toEqual({ code: 401, action: 'logout', reason: 'LOGGED_OUT' });
    expect(classify).toHaveBeenCalledExactlyOnceWith(error);
  });
});
