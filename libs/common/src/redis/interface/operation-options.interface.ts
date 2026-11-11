export interface RedisOperationOptions {
  db?: number;
}
export interface RedisSetOptions extends RedisOperationOptions {
  /** Milliseconds; null disables expiration, undefined uses the class default. */
  ttlMs?: number | null;
}
