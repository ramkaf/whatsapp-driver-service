import { Inject, Injectable, Logger } from '@nestjs/common';
import type { OnApplicationShutdown } from '@nestjs/common';
import type { Prisma, WaSessionLogLevel } from '@database/client.js';
import { PrismaService } from '../../../../../libs/prisma/prisma.service.ts';
import type { SessionRuntime } from '../../interfaces/session-runtime.ts';

export type ConnectionSessionLogLevel = WaSessionLogLevel;
export type ConnectionSessionLogRuntime = Partial<SessionRuntime>;
export interface ConnectionSessionLogData {
  sessionId?: string;
  event: string;
  message?: string;
  [key: string]: unknown;
}

export interface ConnectionSessionLogger {
  log(data: ConnectionSessionLogData): void;
  warn(data: ConnectionSessionLogData, error?: unknown): void;
  error(data: ConnectionSessionLogData, error?: unknown): void;
  exception(data: ConnectionSessionLogData, error: unknown): void;
  retry(data: ConnectionSessionLogData): void;
}

const sensitiveKey =
  /password|secret|token|authorization|cookie|credential|creds|auth|socket|^qr$|pairing.?code|private.?key|^private$|signal.?key|noiseKey|signedIdentityKey|signedPreKey|identityKey|signalIdentities|^value$/i;
const credentialBlock =
  /\b(?:creds|credentials|noiseKey|signedIdentityKey|signedPreKey|identityKey|authState|signalIdentities|advSecretKey|private)["']?\s*[:=]\s*(?:\{|\[|Buffer\b|Uint8Array\b|["'])/i;
const maxText = 8192;

function redact(text: string, secrets: string[]): string {
  // A formatted persistence error may include an entire multiline credentials
  // object. Omit that text rather than attempting to parse arbitrary JS/JSON.
  if (credentialBlock.test(text)) return '[Credential details omitted]';
  let result = text;
  for (const secret of secrets)
    result = result.split(secret).join('[REDACTED]');
  return result
    .replace(/\bBearer\s+[^\s,;]+/gi, 'Bearer [REDACTED]')
    .replace(/([a-z][a-z0-9+.-]*:\/\/[^:\s/@]+:)[^@\s]+@/gi, '$1[REDACTED]@')
    .replace(
      /((?:password|secret|token|authorization|cookie|pairing[_ -]?code)\s*[:=]\s*)[^\s,;]+/gi,
      '$1[REDACTED]',
    )
    .slice(0, maxText);
}

function safeException(error: Error, secrets: string[]) {
  const rawCode = 'code' in error ? error.code : undefined;
  const code =
    typeof rawCode === 'string' && /^[A-Z][A-Z0-9_]{1,63}$/.test(rawCode)
      ? rawCode
      : typeof rawCode === 'number' && Number.isSafeInteger(rawCode)
        ? rawCode
        : null;
  const name = redact(error.name, secrets);
  const prisma = /^PrismaClient/.test(error.name);
  if (
    !prisma &&
    !credentialBlock.test(error.message) &&
    !credentialBlock.test(error.stack ?? '')
  ) {
    return {
      name,
      message: redact(error.message, secrets),
      stack: error.stack ? redact(error.stack, secrets) : null,
      code,
    };
  }

  const message = prisma
    ? `Prisma operation failed${code !== null ? ` (${code})` : ''}; invocation details omitted.`
    : 'Exception details omitted because they contain authentication material.';
  const frames = (error.stack ?? '')
    .split('\n')
    .filter((line) => /^\s+at\s+.*(?:\S+:\d+:\d+\)?|\(native\))\s*$/.test(line))
    .filter((line) => !credentialBlock.test(line))
    .map((line) => redact(line, secrets));
  return {
    name,
    message,
    stack: error.stack
      ? [`${name}: ${message}`, ...frames].join('\n').slice(0, maxText)
      : null,
    code,
  };
}

function safeMetadata(
  input: unknown,
  secrets: string[],
): Prisma.InputJsonObject {
  const seen = new WeakSet<object>();
  let budget = 32768;
  let remainingValues = 300;
  const visit = (
    value: unknown,
    depth: number,
  ): Prisma.InputJsonValue | null => {
    if (budget <= 0 || remainingValues-- <= 0) return '[TRUNCATED]';
    if (value === null || value === undefined) return null;
    if (typeof value === 'string') {
      const text = redact(value, secrets).slice(0, budget);
      budget -= text.length;
      return text;
    }
    if (typeof value === 'number') return Number.isFinite(value) ? value : null;
    if (typeof value === 'boolean') return value;
    if (typeof value === 'bigint') return visit(value.toString(), depth);
    if (typeof value !== 'object') return null;
    if (value instanceof Date)
      return Number.isFinite(value.getTime()) ? value.toISOString() : null;
    if (Buffer.isBuffer(value) || ArrayBuffer.isView(value)) return '[BINARY]';
    if (seen.has(value)) return '[CIRCULAR]';
    if (depth >= 5) return '[TRUNCATED]';
    seen.add(value);
    if (Array.isArray(value))
      return value.slice(0, 20).map((entry) => visit(entry, depth + 1));
    if (value instanceof Error) return safeException(value, secrets);
    const output: Record<string, Prisma.InputJsonValue | null> = {};
    for (const [rawKey, entry] of Object.entries(value).slice(0, 40)) {
      if (remainingValues <= 0 || budget <= 0) break;
      const key = rawKey.slice(0, 128);
      budget -= key.length;
      if (
        sensitiveKey.test(key) ||
        (key === 'code' && typeof entry === 'string')
      ) {
        output[key] = '[REDACTED]';
      } else {
        output[key] = visit(entry, depth + 1);
      }
    }
    return output;
  };
  try {
    return visit(input, 0) as Prisma.InputJsonObject;
  } catch {
    return { serializationError: true };
  }
}

function date(value: unknown): Date | null {
  if (value === null || value === undefined) return null;
  const result = new Date(Number(value));
  return Number.isFinite(result.getTime()) ? result : null;
}

function integer(value: unknown): number | null {
  return typeof value === 'number' && Number.isInteger(value) ? value : null;
}

@Injectable()
export class ConnectionSessionLogService implements OnApplicationShutdown {
  private readonly pending = new Set<Promise<void>>();
  private readonly consoles = new Map<string, Logger>();
  private readonly fallback = new Logger(ConnectionSessionLogService.name);

  constructor(@Inject(PrismaService) private readonly prisma: PrismaService) {}

  createLogger(
    context: string,
    resolveRuntime?: (
      sessionId: string,
    ) => ConnectionSessionLogRuntime | undefined,
  ): ConnectionSessionLogger {
    const write = (
      level: ConnectionSessionLogLevel,
      data: ConnectionSessionLogData,
      error?: unknown,
    ) => {
      void this.write(
        context,
        level,
        data,
        data.sessionId ? resolveRuntime?.(data.sessionId) : undefined,
        error,
      );
    };
    return {
      log: (data) => write('INFO', data),
      warn: (data, error) => write('WARN', data, error),
      error: (data, error) => write('ERROR', data, error),
      exception: (data, error) => write('EXCEPTION', data, error),
      retry: (data) => write('RETRY', data),
    };
  }

  write(
    context: string,
    level: ConnectionSessionLogLevel,
    data: ConnectionSessionLogData,
    runtime?: ConnectionSessionLogRuntime,
    error?: unknown,
  ): Promise<void> {
    const secrets = [runtime?.qr?.value, runtime?.code?.value].filter(
      (value): value is string => typeof value === 'string' && value.length > 0,
    );
    const clean = (value: string) => redact(value, secrets);
    const exception =
      error instanceof Error ? safeException(error, secrets) : undefined;
    const metadata: Prisma.InputJsonObject = {
      ...safeMetadata(data, secrets),
      ...(exception?.code !== null && exception?.code !== undefined
        ? { errorCode: exception.code }
        : {}),
    };
    const sessionId = data.sessionId ?? runtime?.sessionId;
    const qrExpiresAt = date(runtime?.qr?.expiresAt);
    const codeExpiresAt = date(runtime?.code?.expiresAt);
    const record: Prisma.WaSessionLogCreateInput = {
      sessionId: sessionId?.slice(0, 191) ?? null,
      level,
      event: clean(data.event).slice(0, 100),
      context: context.slice(0, 100),
      message: clean(data.message ?? data.event),
      metadata,
      errorName: exception ? exception.name.slice(0, 191) : null,
      errorMessage:
        exception || error !== undefined
          ? (exception?.message ?? clean(String(error)))
          : null,
      errorStack: exception?.stack ?? null,
      status: runtime?.status ?? null,
      socketConnected:
        runtime && 'socket' in runtime ? !!runtime.socket?.ws.isOpen : null,
      generation: integer(runtime?.generation),
      retryCount: integer(runtime?.retryCount),
      nextRetryAt: date(runtime?.nextRetryAt),
      connectedAt: date(runtime?.connectedAt),
      lastDisconnectedAt: date(runtime?.lastDisconnectedAt),
      expiresAt:
        runtime?.pairingMethod === 'CODE' ? codeExpiresAt : qrExpiresAt,
      qrExpiresAt,
      codeExpiresAt,
      stateSince: date(runtime?.stateSince),
      disconnectCode: integer(runtime?.lastDisconnectCode),
      reason: runtime?.reason ?? null,
      createdAt: new Date(),
    };

    let logger = this.consoles.get(context);
    if (!logger) {
      logger = new Logger(context);
      this.consoles.set(context, logger);
    }
    if (level === 'ERROR' || level === 'EXCEPTION') {
      logger.error(metadata, record.errorStack ?? undefined);
    } else if (level === 'WARN' || level === 'RETRY') {
      logger.warn(metadata);
    } else {
      logger.log(metadata);
    }

    const write = Promise.resolve()
      .then(() => this.prisma.waSessionLog.create({ data: record }))
      .then(() => undefined)
      .catch(() => {
        this.fallback.error({
          event: 'session_log_write_failed',
          sessionId: record.sessionId,
          source: context,
        });
      });
    this.pending.add(write);
    void write.finally(() => this.pending.delete(write));
    return write;
  }

  async flush(): Promise<void> {
    while (this.pending.size) await Promise.all([...this.pending]);
  }

  async onApplicationShutdown(): Promise<void> {
    await this.flush();
  }
}
