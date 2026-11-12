import type { MediaTransferFailure } from '../interfaces/media.interface.ts';

export function isMediaTransferFailure(
  value: unknown,
): value is MediaTransferFailure {
  return (
    value !== null &&
    typeof value === 'object' &&
    'status' in value &&
    value.status === 'failed' &&
    'stage' in value &&
    (value.stage === 'download' || value.stage === 'upload')
  );
}

/** Avoid persisting signed links, credentials or multi-line log injection. */
function safeErrorText(value: string): string {
  return value
    .replace(/https?:\/\/[^\s<>"']+/gi, '[redacted-url]')
    .replace(
      /((?:authorization|access[_-]?key|secret[_-]?key|password|token|signature)\s*[:=]\s*)(?:Bearer\s+)?[^\s,;]+/gi,
      '$1[redacted]',
    )
    .replace(/[\r\n\t]+/g, ' ')
    .slice(0, 2000);
}

export function createMediaTransferFailure(
  stage: MediaTransferFailure['stage'],
  operation: string,
  error: unknown,
): MediaTransferFailure {
  const candidate =
    error !== null && typeof error === 'object'
      ? (error as {
          message?: unknown;
          code?: unknown;
          cause?: { code?: unknown };
          statusCode?: unknown;
          output?: { statusCode?: unknown };
        })
      : undefined;
  const code =
    candidate?.code ??
    candidate?.cause?.code ??
    candidate?.statusCode ??
    candidate?.output?.statusCode;
  const message =
    typeof candidate?.message === 'string'
      ? candidate.message
      : typeof error === 'string'
        ? error
        : 'Unknown media transfer error';

  return {
    status: 'failed',
    stage,
    operation,
    error: safeErrorText(message),
    errorCode:
      typeof code === 'string' || typeof code === 'number'
        ? safeErrorText(String(code)).slice(0, 128)
        : null,
  };
}
