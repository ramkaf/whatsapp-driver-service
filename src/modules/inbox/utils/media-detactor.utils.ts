import type { WAMessage } from '@whiskeysockets/baileys';
import { getMessageMediaDescriptor } from '../../media/utils/media-descriptor.util.ts';

export class MediaDetectorUtil {
  static hasMedia(message: WAMessage): boolean {
    return getMessageMediaDescriptor(message) !== null;
  }
}
