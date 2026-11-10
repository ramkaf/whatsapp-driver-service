-- AlterTable
ALTER TABLE `whatsapp_message_inbox` ADD COLUMN `mediaProcessingAt` DATETIME(3) NULL,
    ADD COLUMN `sourceSessionId` VARCHAR(191) NOT NULL DEFAULT 'cmw98k683027xdlh6dvvycc7b';
