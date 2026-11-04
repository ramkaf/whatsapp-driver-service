-- CreateTable
CREATE TABLE `wa_sessions` (
    `id` VARCHAR(30) NOT NULL,
    `name` VARCHAR(100) NOT NULL,
    `phone` VARCHAR(20) NULL,
    `status` ENUM('DISCONNECTED', 'CONNECTING', 'AWAITING_PAIRING', 'CONNECTED', 'LOGGED_OUT', 'RECONNECTING', 'FAILED', 'EXPIRED') NOT NULL DEFAULT 'DISCONNECTED',
    `retry_count` INTEGER NOT NULL DEFAULT 0,
    `last_connected_at` DATETIME(3) NULL,
    `last_disconnected_at` DATETIME(3) NULL,
    `last_disconnect_code` INTEGER NULL,
    `last_error` TEXT NULL,
    `instance_id` VARCHAR(100) NULL,
    `last_heartbeat_at` DATETIME(3) NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updated_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    UNIQUE INDEX `wa_sessions_phone_key`(`phone`),
    INDEX `wa_sessions_status_last_heartbeat_at_idx`(`status`, `last_heartbeat_at`),
    INDEX `wa_sessions_instance_id_idx`(`instance_id`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `wa_auth_creds` (
    `id` VARCHAR(30) NOT NULL,
    `session_id` VARCHAR(30) NOT NULL,
    `creds` JSON NOT NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updated_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    UNIQUE INDEX `wa_auth_creds_session_id_key`(`session_id`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `wa_auth_keys` (
    `id` VARCHAR(30) NOT NULL,
    `session_id` VARCHAR(30) NOT NULL,
    `type` VARCHAR(100) NOT NULL,
    `key_id` VARCHAR(255) NOT NULL,
    `value` JSON NOT NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updated_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    UNIQUE INDEX `wa_auth_keys_session_id_type_key_id_key`(`session_id`, `type`, `key_id`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `wa_session_events` (
    `id` VARCHAR(30) NOT NULL,
    `session_id` VARCHAR(30) NOT NULL,
    `event` ENUM('SESSION_CREATED', 'CONNECTION_STARTED', 'CONNECTION_OPENED', 'CONNECTION_CLOSED', 'CONNECTION_REPLACED', 'PAIRING_CODE_REQUESTED', 'PAIRING_COMPLETED', 'PAIRING_EXPIRED', 'RECONNECT_SCHEDULED', 'AUTH_UPDATED', 'ERROR') NOT NULL,
    `status_code` INTEGER NULL,
    `message` TEXT NULL,
    `metadata` JSON NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `wa_session_events_session_id_created_at_idx`(`session_id`, `created_at`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- AddForeignKey
ALTER TABLE `wa_auth_creds` ADD CONSTRAINT `wa_auth_creds_session_id_fkey` FOREIGN KEY (`session_id`) REFERENCES `wa_sessions`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `wa_auth_keys` ADD CONSTRAINT `wa_auth_keys_session_id_fkey` FOREIGN KEY (`session_id`) REFERENCES `wa_sessions`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `wa_session_events` ADD CONSTRAINT `wa_session_events_session_id_fkey` FOREIGN KEY (`session_id`) REFERENCES `wa_sessions`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;
