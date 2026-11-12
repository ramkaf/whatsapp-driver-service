-- Existing rows may have come from live messages or history. Preserve that
-- uncertainty instead of assigning an incorrect source event.
ALTER TABLE `whatsapp_message_inbox`
  ADD COLUMN `event` VARCHAR(64) NOT NULL DEFAULT 'legacy.message';
ALTER TABLE `whatsapp_message_inbox` ALTER COLUMN `event` DROP DEFAULT;

CREATE INDEX `whatsapp_message_inbox_status_createdAt_idx`
  ON `whatsapp_message_inbox` (`status`, `createdAt`);
CREATE INDEX `whatsapp_message_inbox_haveMedia_mediaStatus_updatedAt_idx`
  ON `whatsapp_message_inbox` (`haveMedia`, `mediaStatus`, `updatedAt`);
