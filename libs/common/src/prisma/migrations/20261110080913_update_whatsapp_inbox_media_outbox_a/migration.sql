-- DropIndex
DROP INDEX `whatsapp_message_inbox_haveMedia_mediaStatus_idx` ON `whatsapp_message_inbox`;

-- DropIndex
DROP INDEX `whatsapp_message_inbox_mediaStatus_createdAt_idx` ON `whatsapp_message_inbox`;

-- DropIndex
DROP INDEX `whatsapp_message_inbox_status_createdAt_idx` ON `whatsapp_message_inbox`;

-- AlterTable
ALTER TABLE `whatsapp_message_inbox` ADD PRIMARY KEY (`id`);
