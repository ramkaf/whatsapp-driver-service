/*
  Warnings:

  - The primary key for the `whatsapp_message_inbox` table will be changed. If it partially fails, the table could be left without primary key constraint.
  - You are about to drop the column `messageType` on the `whatsapp_message_inbox` table. All the data in the column will be lost.

*/
-- AlterTable
ALTER TABLE `whatsapp_message_inbox` DROP PRIMARY KEY,
    DROP COLUMN `messageType`;
