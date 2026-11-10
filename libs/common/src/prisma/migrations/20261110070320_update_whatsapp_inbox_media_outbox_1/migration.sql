/*
  Warnings:

  - You are about to drop the column `mediaError` on the `whatsapp_message_inbox` table. All the data in the column will be lost.
  - You are about to drop the column `mediaProcessingAt` on the `whatsapp_message_inbox` table. All the data in the column will be lost.
  - You are about to drop the column `mediaRetryCount` on the `whatsapp_message_inbox` table. All the data in the column will be lost.
  - You are about to drop the column `processedAt` on the `whatsapp_message_inbox` table. All the data in the column will be lost.
  - You are about to drop the column `processingError` on the `whatsapp_message_inbox` table. All the data in the column will be lost.

*/
-- AlterTable
ALTER TABLE `whatsapp_message_inbox` DROP COLUMN `mediaError`,
    DROP COLUMN `mediaProcessingAt`,
    DROP COLUMN `mediaRetryCount`,
    DROP COLUMN `processedAt`,
    DROP COLUMN `processingError`,
    ADD COLUMN `messageType` ENUM('INCOMING', 'OUTGOING', 'USER_NOTIFICATION') NOT NULL DEFAULT 'INCOMING';
