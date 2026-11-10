import { RabbitMQError } from '../error/rabbitmq.error.ts';
export async function within<T>(
  promise: Promise<T>,
  milliseconds: number,
  code = 'OPERATION_TIMEOUT',
): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      promise,
      new Promise<never>((_, reject) => {
        timer = setTimeout(
          () => reject(new RabbitMQError(code, code)),
          Math.max(0, milliseconds),
        );
      }),
    ]);
  } finally {
    clearTimeout(timer);
  }
}
export function positive(value: number, name: string): number {
  if (!Number.isSafeInteger(value) || value <= 0)
    throw new RabbitMQError(
      'INVALID_CONFIG',
      `${name} must be a positive integer`,
    );
  return value;
}
