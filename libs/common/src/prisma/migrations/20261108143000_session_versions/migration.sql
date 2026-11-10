-- Keep previous sessions and their authentication as history for the same phone.
-- Current versions have superseded_at IS NULL; isEnabled controls recovery.
ALTER TABLE `wa_sessions`
    ADD COLUMN `superseded_at` DATETIME(3) NULL,
    ADD INDEX `wa_sessions_phone_superseded_at_idx` (`phone`, `superseded_at`);
DROP INDEX `wa_sessions_phone_key` ON `wa_sessions`;
