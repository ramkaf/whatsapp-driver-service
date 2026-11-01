import { getContentType, normalizeMessageContent } from 'baileys';
import type { proto, WAMessage } from 'baileys';
import { appendFile } from 'node:fs/promises';
import { join, basename } from 'node:path';

// Reconstructs the quoted message using its original identifiers and content.
export function extractRepliedMessage(message: WAMessage): WAMessage | null {
  const content = normalizeMessageContent(message.message);
  const type = content && getContentType(content);
  const payload = type ? content?.[type] : undefined;

  if (!payload || typeof payload !== 'object' || !('contextInfo' in payload)) {
    return null;
  }

  const context = payload.contextInfo as proto.IContextInfo | null | undefined;
  if (!context?.quotedMessage) {
    return null;
  }

  return {
    key: {
      remoteJid: context.remoteJid || message.key.remoteJid,
      id: context.stanzaId,
      participant: context.participant,
    },
    message: context.quotedMessage,
  };
}

export function safeId(value: string): string {
  return value.replace(/[^a-zA-Z0-9@._:-]/g, '_').slice(0, 180);
}

export async function appendJsonl<T>(fileName: string, data: T): Promise<void> {
  const name = basename(fileName);
  const filePath = join(
    process.cwd(),
    name.endsWith('.jsonl') ? name : `${name}.jsonl`,
  );

  await appendFile(filePath, JSON.stringify(data) + '\n', 'utf8');
}
