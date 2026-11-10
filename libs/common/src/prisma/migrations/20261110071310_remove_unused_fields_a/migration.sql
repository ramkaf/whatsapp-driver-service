/*
  Warnings:

  - The primary key for the `whatsapp_message_inbox` table will be changed. If it partially fails, the table could be left without primary key constraint.

*/
-- AlterTable
ALTER TABLE `whatsapp_message_inbox` DROP PRIMARY KEY,
    ADD PRIMARY KEY (`id`, `messageType`);
