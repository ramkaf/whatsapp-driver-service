import { Injectable } from '@nestjs/common';
import type { ConnectionState } from '@whiskeysockets/baileys';
import { DisconnectClassifierService } from '../disconnect/disconnect-classifier.service.ts';
import type { ProcessedConnectionUpdate } from '../../interfaces/connection-update.ts';

// Normalizes socket connection events for session lifecycle orchestration.
@Injectable()
export class ConnectionHandlerService {
  constructor(private readonly classifier: DisconnectClassifierService) {}

  process(update: Partial<ConnectionState>): ProcessedConnectionUpdate {
    return {
      qr: update.qr,
      authenticating: update.isNewLogin === true,
      connection: update.connection,
      disconnect:
        update.connection === 'close'
          ? this.classifier.classify(update.lastDisconnect?.error)
          : null,
    };
  }
}
