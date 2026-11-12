import {
  isJidGroup,
  jidDecode,
  jidNormalizedUser,
} from '@whiskeysockets/baileys';
import type { WAMessage } from '@whiskeysockets/baileys';
import type { ReformedMessageUpsertPayload } from '../events/message-upsert/interfaces/message-upsert.interface.ts';

/** Only phone-number JIDs contain a phone number; LID digits are not a phone. */
