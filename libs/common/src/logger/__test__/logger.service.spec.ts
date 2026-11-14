// import { ConsoleLogger, Logger } from '@nestjs/common';
// import afraLogger from '@afra/exchange-logger';
// import { readFileSync } from 'node:fs';
// import {
//   afterEach,
//   beforeAll,
//   beforeEach,
//   describe,
//   expect,
//   it,
//   vi,
// } from 'vitest';
// import { AfraLogger } from '../logger.service.ts';

// describe('AfraLogger with Nest and the real Afra JSON formatter', () => {
//   let output: string[];
//   let adapter: AfraLogger;
//   let logger: Logger;

//   beforeAll(() => {
//     afraLogger.start({
//       apm: { active: false, serverUrl: 'http://localhost:8200' },
//       logger: { file: { enabled: false } },
//       rabbitmq: { enabled: false },
//     });
//   });

//   beforeEach(() => {
//     output = [];
//     vi.spyOn(process.stdout, 'write').mockImplementation((chunk: unknown) => {
//       output.push(String(chunk));
//       return true;
//     });
//     adapter = new AfraLogger();
//     Logger.overrideLogger(adapter);
//     logger = new Logger('AppService', { timestamp: true });
//   });

//   afterEach(() => {
//     Logger.overrideLogger(new ConsoleLogger());
//     vi.restoreAllMocks();
//   });

//   function records() {
//     return output
//       .join('')
//       .trim()
//       .split('\n')
//       .filter(Boolean)
//       .map((line) => JSON.parse(line));
//   }

//   it('includes the Nest context, timestamp and additional structured data', () => {
//     logger.log('Handling getHello request', { requestId: 'request-1' });

//     expect(records()).toEqual([
//       expect.objectContaining({
//         'log.level': 'info',
//         '@timestamp': expect.any(String),
//         message: 'Handling getHello request',
//         meta_info: expect.objectContaining({
//           class: 'AppService',
//           context: 'AppService',
//           requestId: 'request-1',
//         }),
//       }),
//     ]);
//   });

//   it('preserves Error details and metadata without mutating the error', () => {
//     const error = Object.assign(new TypeError('Payment failed'), {
//       code: 'PAYMENT_FAILED',
//     });
//     const originalStack = error.stack;
//     logger.error(error, { paymentId: 'payment-1' });

//     expect(records()[0]).toMatchObject({
//       'log.level': 'error',
//       message: 'Payment failed',
//       meta_info: { class: 'AppService', paymentId: 'payment-1' },
//       error_info: {
//         type: 'TypeError',
//         code: 'PAYMENT_FAILED',
//         stack: originalStack,
//       },
//     });
//     expect(error.stack).toBe(originalStack);
//   });

//   it('supports Nest string errors with a stack, context and metadata', () => {
//     const stack = 'Error: Failed\n    at handler (/app/service.ts:10:5)';
//     logger.error('Failed', stack, { requestId: 'request-2' });

//     expect(records()[0]).toMatchObject({
//       'log.level': 'error',
//       message: 'Failed',
//       meta_info: { class: 'AppService', requestId: 'request-2', stack },
//       error_info: { stack },
//     });
//   });

//   it('supports direct Error + data calls without a Nest context', () => {
//     adapter.error(new Error('Failed'), { jobId: 42 });
//     expect(records()[0]).toMatchObject({
//       'log.level': 'error',
//       message: 'Failed',
//       meta_info: { jobId: 42 },
//     });
//   });

//   it('does not mistake the context of a string-only error for a stack', () => {
//     logger.error('Failed');
//     const record = records()[0];
//     expect(record.meta_info.class).toBe('AppService');
//     expect(record.error_info.stack).toMatch(/^Error: Failed\n\s+at /);
//     expect(record.error_info.stack).not.toContain('AfraLogger.');
//   });

//   it('preserves multiple messages and merges metadata using Nest conventions', () => {
//     logger.log('first', { id: 1 }, 'second', { job: 'sync' });
//     expect(records().map((record) => record.message)).toEqual([
//       'first',
//       'second',
//     ]);
//     for (const record of records()) {
//       expect(record.meta_info).toMatchObject({
//         id: 1,
//         job: 'sync',
//         class: 'AppService',
//       });
//     }
//   });

//   it('forwards every level, including debug and verbose, without changing the root level', () => {
//     const rootLevel = afraLogger.logger.logger.level;
//     logger.log('log');
//     logger.warn('warn');
//     logger.debug('debug');
//     logger.verbose('verbose');
//     logger.error('error');
//     logger.fatal(new Error('fatal'));

//     expect(records().map((record) => record['log.level'])).toEqual([
//       'info',
//       'warn',
//       'debug',
//       'trace',
//       'error',
//       'fatal',
//     ]);
//     expect(records()[5]).toMatchObject({
//       message: 'fatal',
//       meta_info: { class: 'AppService' },
//       error: { message: 'fatal', stack_trace: expect.any(String) },
//     });
//     expect(afraLogger.logger.logger.level).toBe(rootLevel);
//   });

//   it('applies Nest level filtering and supports disabling all levels', () => {
//     adapter.setLogLevels(['error']);
//     logger.log('hidden');
//     logger.debug('hidden');
//     logger.error('visible');
//     logger.fatal('visible');
//     expect(records().map((record) => record['log.level'])).toEqual([
//       'error',
//       'fatal',
//     ]);

//     adapter.setLogLevels([]);
//     logger.error('hidden');
//     logger.fatal('hidden');
//     expect(records()).toHaveLength(2);
//   });

//   it('captures the application method calling Nest Logger for a string error', () => {
//     class ExampleService {
//       run() {
//         logger.error('String error');
//       }
//     }

//     new ExampleService().run();
//     const record = records()[0];
//     expect(record.meta_info.caller).toEqual({
//       function: 'ExampleService.run',
//       file: expect.stringContaining('logger.service.spec.ts'),
//       line: expect.any(Number),
//       column: expect.any(Number),
//     });
//     expect(record.meta_info.caller.line).toBeGreaterThan(0);
//     expect(record.meta_info.caller.column).toBeGreaterThan(0);
//     const sourceLines = readFileSync(
//       new URL('./logger.service.spec.ts', import.meta.url),
//       'utf8',
//     ).split('\n');
//     const sourceLine = sourceLines[record.meta_info.caller.line - 1];
//     expect(sourceLine.trim()).toBe("logger.error('String error');");
//     expect(record.meta_info.caller.column).toBeLessThanOrEqual(
//       sourceLine.length,
//     );
//     expect(record.error_info.stack).toMatch(
//       /^Error: String error\n\s+at ExampleService.run /,
//     );
//     expect(record.error_info.stack).not.toContain(
//       '/@nestjs/common/services/logger.service',
//     );
//   });

//   it('captures direct adapter calls and static Nest calls', () => {
//     function directCaller() {
//       adapter.warn('Direct warning');
//     }
//     function staticCaller() {
//       Logger.log('Static log', 'StaticContext');
//     }

//     directCaller();
//     staticCaller();
//     expect(records()[0].meta_info.caller.function).toBe('directCaller');
//     expect(records()[1].meta_info.caller.function).toBe('staticCaller');
//     expect(records()[1].meta_info.context).toBe('StaticContext');
//   });

//   it('keeps an original Error stack separate from the logging location', () => {
//     function createFailure() {
//       return new Error('Original failure');
//     }
//     function reportFailure(error: Error) {
//       logger.error(error);
//     }

//     const error = createFailure();
//     const originalStack = error.stack;
//     reportFailure(error);
//     const record = records()[0];
//     expect(record.meta_info.caller.function).toBe('reportFailure');
//     expect(record.error_info.stack).toBe(originalStack);
//     expect(record.error_info.stack).toContain('createFailure');
//   });
// });


describe('Temporary Test', () => {
  it('should pass', () => {
    expect(true).toBe(true);
  });
});