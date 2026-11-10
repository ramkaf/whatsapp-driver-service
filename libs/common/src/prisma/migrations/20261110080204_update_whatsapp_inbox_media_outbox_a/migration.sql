/*
  Warnings:

  - You are about to drop the column `sourceSessionId` on the `whatsapp_message_inbox` table. All the data in the column will be lost.

*/
-- AlterTable
ALTER TABLE `whatsapp_message_inbox` DROP COLUMN `sourceSessionId`,
    ADD COLUMN `sessionId` VARCHAR(191) NOT NULL DEFAULT 'cmw98k683027xdlh6dvvycc7b';
