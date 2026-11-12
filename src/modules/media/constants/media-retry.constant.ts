/** Delays after each failure: one initial attempt, then six retries. */
export const MEDIA_RETRY_DELAYS_MS = [
  5_000,
  15_000,
  2 * 60_000,
  30 * 60_000,
  3 * 60 * 60_000,
  24 * 60 * 60_000,
] as const;

export const MEDIA_MAX_ATTEMPTS = MEDIA_RETRY_DELAYS_MS.length + 1;

/** A dead process cannot keep an inbox row claimed forever. */
export const MEDIA_PROCESSING_LEASE_MS = 15 * 60_000;
export const MEDIA_LEASE_RENEW_INTERVAL_MS = 60_000;
