import { ConsoleLogger, Injectable } from '@nestjs/common';
import type { LogLevel } from '@nestjs/common';
import loggerService from '@afra/exchange-logger';
import { inspect } from 'node:util';

interface LogCaller {
  function: string;
  file: string;
  line: number;
  column: number;
}

@Injectable()
export class AfraLogger extends ConsoleLogger {
  constructor() {
    super();
  }

  log(message: unknown, ...optionalParams: unknown[]): void {
    this.forward('log', message, optionalParams);
  }

  error(message: unknown, ...optionalParams: unknown[]): void {
    this.forward('error', message, optionalParams);
  }

  warn(message: unknown, ...optionalParams: unknown[]): void {
    this.forward('warn', message, optionalParams);
  }

  debug(message: unknown, ...optionalParams: unknown[]): void {
    this.forward('debug', message, optionalParams);
  }

  verbose(message: unknown, ...optionalParams: unknown[]): void {
    this.forward('verbose', message, optionalParams);
  }

  fatal(message: unknown, ...optionalParams: unknown[]): void {
    this.forward('fatal', message, optionalParams);
  }

  setLogLevels(levels: LogLevel[]): void {
    super.setLogLevels([...levels]);
  }

  private forward(
    level: LogLevel,
    message: unknown,
    optionalParams: unknown[],
  ): void {
    if (!this.isLevelEnabled(level)) return;

    // Reuse Nest's context, structured-parameter and error-stack conventions.
    const { messages, context, params, stack } =
      level === 'error' || level === 'fatal'
        ? this.getContextAndStackAndMessagesToPrint([
            message,
            ...optionalParams,
          ])
        : {
            ...this.getContextAndMessagesToPrint([message, ...optionalParams]),
            stack: undefined,
          };

    const callSite = this.captureCallSite(level);
    const logger = loggerService.logger.child({
      ...params,
      ...(context !== undefined ? { context, class: context } : {}),
      ...(callSite.caller ? { caller: callSite.caller } : {}),
      ...(stack !== undefined ? { stack } : {}),
    });

    // Nest controls filtering. Pino's default "info" would otherwise hide
    // debug/verbose even when Nest enables them. Only this child is changed.
    logger.logger.level = 'trace';

    for (const entry of messages) {
      switch (level) {
        case 'log':
          logger.info(entry);
          break;
        case 'warn':
          logger.warn(entry);
          break;
        case 'debug':
          logger.debug(entry);
          break;
        case 'verbose':
          logger.logger.trace(entry);
          break;
        case 'error':
          logger.error(this.toError(entry, stack, callSite.stack));
          break;
        case 'fatal': {
          const error = this.toError(entry, stack, callSite.stack);
          // Afra's wrapper has no fatal method; use its underlying Pino logger.
          logger.logger.fatal({ err: error }, error.message);
          break;
        }
      }
    }
  }

  private captureCallSite(level: LogLevel): {
    caller?: LogCaller;
    stack?: string;
  } {
    const trace: { stack?: string } = {};
    // Omit this adapter through its public log/error/etc. method. Reading the
    // formatted stack preserves the runtime's source-map/APM stack handling.
    Error.captureStackTrace(trace, this[level]);
    const frames = trace.stack?.split('\n').slice(1) ?? [];

    for (const [index, frame] of frames.entries()) {
      const named = /^\s*at (.+) \((.+):(\d+):(\d+)\)$/.exec(frame);
      const anonymous = named ? null : /^\s*at (.+):(\d+):(\d+)$/.exec(frame);
      if (!named && !anonymous) continue;

      const [file, line, column] = named ? named.slice(2) : anonymous!.slice(1);
      // Nest's Logger adds forwarding and buffering frames before the caller.
      const normalizedFile = file.replaceAll('\\', '/');
      if (
        /\/@nestjs\/common\/services\/(?:console-)?logger\.service\.[cm]?[jt]s$/.test(
          normalizedFile,
        ) ||
        normalizedFile.startsWith('node:')
      )
        continue;

      return {
        caller: {
          function: named?.[1] ?? '<anonymous>',
          file,
          line: Number(line),
          column: Number(column),
        },
        stack: frames.slice(index).join('\n'),
      };
    }

    return {};
  }

  private toError(
    message: unknown,
    stack?: string,
    callerStack?: string,
  ): Error {
    // Preserve Error subclasses and fields used by Afra (e.g. Axios metadata).
    // An explicitly supplied stack is also retained in the child metadata.
    if (message instanceof Error) return message;

    const error = new Error(
      typeof message === 'string' ? message : inspect(message),
    );
    // Prefer the supplied stack; otherwise use the captured logging location.
    error.stack =
      stack ??
      (callerStack
        ? `${error.name}: ${error.message}\n${callerStack}`
        : undefined);
    return error;
  }
}
