/*
  Warnings:

  - You are about to drop the column `mediaMimeType` on the `whatsapp_message_inbox` table. All the data in the column will be lost.
  - You are about to drop the column `temp` on the `whatsapp_message_inbox` table. All the data in the column will be lost.

*/
-- AlterTable
ALTER TABLE `whatsapp_message_inbox` DROP COLUMN `mediaMimeType`,
    DROP COLUMN `temp`;
