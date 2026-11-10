/*
  Warnings:

  - You are about to drop the column `instance_id` on the `wa_sessions` table. All the data in the column will be lost.

*/
-- DropIndex
DROP INDEX `wa_sessions_instance_id_idx` ON `wa_sessions`;

-- AlterTable
ALTER TABLE `wa_sessions` DROP COLUMN `instance_id`;
