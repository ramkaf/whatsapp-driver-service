import { Injectable, Logger } from '@nestjs/common';
import { appendJsonToFile } from '../../../../libs/common/utils/file.util.ts';
import { safeId } from '../../utils/message.util.ts';
import { join } from 'node:path';

@Injectable()
export class JsonlService {
  private readonly writeQueues = new Map<string, Promise<void>>();

  async append(filePath: string, data: unknown): Promise<void> {
    const previous = this.writeQueues.get(filePath) ?? Promise.resolve();

    const current = previous
      .catch(() => undefined)
      .then(() => appendJsonToFile(filePath, data));

    this.writeQueues.set(filePath, current);

    try {
      await current;
    } finally {
      if (this.writeQueues.get(filePath) === current) {
        this.writeQueues.delete(filePath);
      }
    }
  }

  saveToFile(data: any): Promise<void> {
    const safeChatId = safeId(data.chatId);
    const filePath = join(
      process.cwd(),
      'storage',
      'whatsapp',
      'conversations',
      `${safeChatId}.jsonl`,
    );
    return appendJsonToFile(filePath, data);
  }
}
