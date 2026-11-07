-- Generated from Prisma schema diff; not executed against a database.
-- AlterTable
ALTER TABLE `wa_sessions` ADD COLUMN `enabled` BOOLEAN NOT NULL DEFAULT true,
    ADD COLUMN `pairing_method` ENUM('CODE', 'QR') NOT NULL DEFAULT 'QR',
    MODIFY `status` ENUM('DISCONNECTED', 'CONNECTING', 'AWAITING_PAIRING', 'CONNECTED', 'LOGGED_OUT', 'RECONNECTING', 'FAILED', 'EXPIRED', 'AUTHENTICATING') NOT NULL DEFAULT 'DISCONNECTED';

-- Signal key identifiers are case-sensitive; avoid aliasing distinct keys.
ALTER TABLE `wa_auth_keys`
  MODIFY COLUMN `type` VARCHAR(100) CHARACTER SET utf8mb4 COLLATE utf8mb4_bin NOT NULL,
  MODIFY COLUMN `key_id` VARCHAR(255) CHARACTER SET utf8mb4 COLLATE utf8mb4_bin NOT NULL;
