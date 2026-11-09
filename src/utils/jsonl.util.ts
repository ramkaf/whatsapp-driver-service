import { appendFile, mkdir } from 'node:fs/promises';
import { join } from 'node:path';

export class JsonlUtil {
  private static readonly storagePath = join(process.cwd(), 'storage');

  static async append(filename: string, data: unknown): Promise<void> {
    if (!filename.endsWith('.jsonl')) {
      filename += '.jsonl';
    }

    // Create storage directory if it doesn't exist
    await mkdir(this.storagePath, { recursive: true });

    const filePath = join(this.storagePath, filename);

    // Append JSON data as a new line
    const line =
      JSON.stringify(data, (_key, value: unknown) =>
        typeof value === 'bigint' ? value.toString() : value,
      ) + '\n';

    await appendFile(filePath, line, {
      encoding: 'utf-8',
      flag: 'a',
    });
  }
}
