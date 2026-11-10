-- AlterTable
ALTER TABLE `whatsapp_message_inbox` ADD COLUMN `haveMedia` BOOLEAN NOT NULL DEFAULT false,
    ADD COLUMN `status` ENUM('PENDING', 'PROCESSING', 'PROCESSED', 'FAILED') NOT NULL DEFAULT 'PENDING';

-- CreateIndex
CREATE INDEX `whatsapp_message_inbox_status_createdAt_idx` ON `whatsapp_message_inbox`(`status`, `createdAt`);

-- CreateIndex
CREATE INDEX `whatsapp_message_inbox_haveMedia_status_idx` ON `whatsapp_message_inbox`(`haveMedia`, `status`);
