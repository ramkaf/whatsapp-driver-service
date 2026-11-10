/*
  Warnings:

  - You are about to alter the column `status` on the `whatsapp_message_inbox` table. The data in that column could be lost. The data in that column will be cast from `Enum(EnumId(2))` to `Enum(EnumId(4))`.

*/
-- DropIndex
DROP INDEX `whatsapp_message_inbox_haveMedia_status_idx` ON `whatsapp_message_inbox`;

-- AlterTable
ALTER TABLE `whatsapp_message_inbox` ADD COLUMN `mediaError` TEXT NULL,
    ADD COLUMN `mediaMimeType` VARCHAR(150) NULL,
    ADD COLUMN `mediaObjectKey` VARCHAR(1024) NULL,
    ADD COLUMN `mediaRetryCount` INTEGER NOT NULL DEFAULT 0,
    ADD COLUMN `mediaStatus` ENUM('NOT_REQUIRED', 'PENDING', 'PROCESSING', 'UPLOADED', 'FAILED') NOT NULL DEFAULT 'NOT_REQUIRED',
    ADD COLUMN `mediaUploadedAt` DATETIME(3) NULL,
    ADD COLUMN `processedAt` DATETIME(3) NULL,
    ADD COLUMN `processingError` TEXT NULL,
    MODIFY `status` ENUM('RECEIVED', 'READY', 'PROCESSING', 'PROCESSED', 'FAILED') NOT NULL DEFAULT 'RECEIVED';

-- CreateTable
CREATE TABLE `whatsapp_message_outbox` (
    `id` VARCHAR(191) NOT NULL,
    `inboxId` VARCHAR(191) NOT NULL,
    `payload` JSON NOT NULL,
    `status` ENUM('PENDING', 'PROCESSING', 'PUBLISHED', 'FAILED') NOT NULL DEFAULT 'PENDING',
    `retryCount` INTEGER NOT NULL DEFAULT 0,
    `lastError` TEXT NULL,
    `publishedAt` DATETIME(3) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    UNIQUE INDEX `whatsapp_message_outbox_inboxId_key`(`inboxId`),
    INDEX `whatsapp_message_outbox_status_createdAt_idx`(`status`, `createdAt`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateIndex
CREATE INDEX `whatsapp_message_inbox_mediaStatus_createdAt_idx` ON `whatsapp_message_inbox`(`mediaStatus`, `createdAt`);

-- CreateIndex
CREATE INDEX `whatsapp_message_inbox_haveMedia_mediaStatus_idx` ON `whatsapp_message_inbox`(`haveMedia`, `mediaStatus`);
