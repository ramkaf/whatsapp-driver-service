ALTER TABLE `whatsapp_message_inbox`
  MODIFY COLUMN `mediaStatus` ENUM('NOT_REQUIRED', 'PENDING', 'PROCESSING', 'UPLOADED', 'FAILED', 'DOWNLOAD_FAILED', 'UPLOAD_FAILED', 'EXHAUSTED') NOT NULL DEFAULT 'NOT_REQUIRED',
  ADD COLUMN `mediaAttemptCount` INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN `mediaNextAttemptAt` DATETIME(3) NULL,
  ADD COLUMN `mediaLastError` TEXT NULL,
  ADD COLUMN `mediaLastErrorCode` VARCHAR(128) NULL,
  ADD COLUMN `mediaLastErrorStage` VARCHAR(32) NULL,
  ADD COLUMN `mediaProcessingToken` VARCHAR(36) NULL,
  ADD COLUMN `mediaLeaseExpiresAt` DATETIME(3) NULL;

-- The old worker did not persist attempts. Treat existing failures as one
-- failed initial attempt, and make interrupted old attempts recoverable.
UPDATE `whatsapp_message_inbox`
  SET `mediaAttemptCount` = 1,
      `mediaNextAttemptAt` = DATE_ADD(CURRENT_TIMESTAMP(3), INTERVAL 5 SECOND)
  WHERE `mediaStatus` = 'FAILED';
UPDATE `whatsapp_message_inbox`
  SET `mediaAttemptCount` = 1,
      `mediaLeaseExpiresAt` = CURRENT_TIMESTAMP(3)
  WHERE `mediaStatus` = 'PROCESSING';

CREATE INDEX `whatsapp_message_inbox_mediaStatus_mediaNextAttemptAt_idx`
  ON `whatsapp_message_inbox` (`mediaStatus`, `mediaNextAttemptAt`);
CREATE INDEX `whatsapp_message_inbox_mediaStatus_mediaLeaseExpiresAt_idx`
  ON `whatsapp_message_inbox` (`mediaStatus`, `mediaLeaseExpiresAt`);
