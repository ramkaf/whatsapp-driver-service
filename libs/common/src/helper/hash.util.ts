import { createHash } from 'crypto';

export class HashUtil {
  static sha256(value: string): string {
    return createHash('sha256').update(value).digest('hex');
  }
}
