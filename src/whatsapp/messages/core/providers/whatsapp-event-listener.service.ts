import { Injectable, Logger } from '@nestjs/common';
import type { WASocket } from 'baileys';

import { WhatsappMessageService } from './whatsapp-message.service.ts';

@Injectable()
export class WhatsappEventListener {
  private readonly logger = new Logger(WhatsappEventListener.name);

  private readonly registeredSockets = new WeakSet<WASocket>();

  constructor(private readonly messageService: WhatsappMessageService) {}

  register(socket: WASocket, isActive: () => boolean): void {
    if (this.registeredSockets.has(socket)) {
      return;
    }

    this.registeredSockets.add(socket);

    // Register event listeners for incoming messages, updates, and deletions
    socket.ev.on('messages.upsert', ({ messages }) => {
      if (!isActive()) return;

      void this.messageService
        .handleUpsert(socket, messages)
        .catch((error: unknown) => {
          this.logError('messages.upsert', error);
        });
    });
    // Register event listeners for incoming messages, updates, and deletions
    socket.ev.on('messages.update', (updates) => {
      if (!isActive()) return;

      void this.messageService
        .handleUpdate(socket, updates)
        .catch((error: unknown) => {
          this.logError('messages.update', error);
        });
    });
    socket.ev.on('messages.reaction', (reactions) => {
      if (!isActive()) return;

      void this.messageService
        .handleReaction(socket, reactions)
        .catch((error: unknown) => {
          this.logError('messages.reaction', error);
        });
    });
    // Register event listeners for incoming messages, updates, and deletions
    socket.ev.on('messages.delete', (data) => {
      if (!isActive()) return;

      void this.messageService
        .handleDelete(socket, data)
        .catch((error: unknown) => {
          this.logError('messages.delete', error);
        });
    });
  }

  private logError(event: string, error: unknown): void {
    this.logger.error(
      `Failed to handle ${event}`,
      error instanceof Error ? error.stack : String(error),
    );
  }
}
