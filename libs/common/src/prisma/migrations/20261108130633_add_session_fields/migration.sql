/*
  Warnings:

  - Made the column `phone` on table `wa_sessions` required. This step will fail if there are existing NULL values in that column.

*/
-- AlterTable
ALTER TABLE `wa_sessions` ADD COLUMN `isEnabled` BOOLEAN NOT NULL DEFAULT true,
    MODIFY `phone` VARCHAR(20) NOT NULL;
