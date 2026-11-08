import { DisconnectErrorParser } from '../providers/disconnect/disconnect-error.parser.ts';

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
