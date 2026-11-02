import { Injectable } from '@nestjs/common';
import { appendJsonToFile } from '../../../../libs/common/utils/file.util.ts';
import { safeId } from '../../utils/message.util.ts';
import { join } from 'node:path';
import { createReadStream } from 'node:fs';
import { createInterface } from 'node:readline';
import { jidNormalizedUser, proto } from 'baileys';
import type { WAMessageKey } from 'baileys';

@Injectable()
export class JsonlService {
  private readonly writeQueues = new Map<string, Promise<void>>();
  private readonly originals = new Map<string, proto.IWebMessageInfo>();

  private messageKey(key: WAMessageKey): string {
    return JSON.stringify([
      jidNormalizedUser(key.remoteJid ?? ''),
      key.id,
      Boolean(key.fromMe),
      jidNormalizedUser(key.participant ?? ''),
    ]);
  }

  remember(message: proto.IWebMessageInfo): void {
    if (!message.key?.remoteJid || !message.key.id || !message.message) return;
    const key = this.messageKey(message.key);
    this.originals.delete(key);
    this.originals.set(key, message);
    if (this.originals.size > 1000) {
      this.originals.delete(this.originals.keys().next().value!);
    }
  }

  async getMessage(key: WAMessageKey): Promise<proto.IMessage | undefined> {
    if (!key.remoteJid || !key.id) return;
    const cached = this.originals.get(this.messageKey(key));
    if (cached) return cached.message ?? undefined;

    const filePath = this.conversationPath(key.remoteJid);
    // Wait for pending archives before reading, including after cache eviction.
    await this.writeQueues.get(filePath);
    const input = createReadStream(filePath, { encoding: 'utf8' });
    const lines = createInterface({ input, crlfDelay: Infinity });
    try {
      for await (const line of lines) {
        let record: { event?: string; message?: unknown };
        try {
          record = JSON.parse(line);
        } catch {
          continue; // A partially written final line must not prevent recovery.
        }
        if (
          record.event !== 'message.received' &&
          record.event !== 'message.sent'
        )
          continue;
        if (!record.message || typeof record.message !== 'object') continue;
        const message = proto.WebMessageInfo.fromObject(record.message);
        if (
          message.key &&
          this.messageKey(message.key) === this.messageKey(key)
        ) {
          this.remember(message);
          return message.message ?? undefined;
        }
      }
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
    } finally {
      lines.close();
      input.destroy();
    }
  }

  private conversationPath(chatId: string): string {
    return join(
      process.cwd(),
      'storage',
      'whatsapp',
      'conversations',
      `${safeId(chatId)}.jsonl`,
    );
  }

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
    return this.append(this.conversationPath(data.chatId), data);
  }
}
