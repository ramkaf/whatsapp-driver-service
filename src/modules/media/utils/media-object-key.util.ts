export function buildMediaObjectKey(sha256: string): string {
  if (!/^[a-f0-9]{64}$/.test(sha256)) {
    throw new Error('Invalid SHA-256 hash');
  }

  return ['media', 'sha256', sha256.slice(0, 2), sha256].join('/');
}
