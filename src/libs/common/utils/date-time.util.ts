export function toISODate(timestamp: number | string): string {
  return new Date(Number(timestamp) * 1000).toISOString();
}
