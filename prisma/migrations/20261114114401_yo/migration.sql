-- CreateTable
CREATE TABLE `wa_sessions` (
    `id` VARCHAR(30) NOT NULL,
    `name` VARCHAR(100) NOT NULL,
    `pairing_method` ENUM('CODE', 'QR') NOT NULL DEFAULT 'QR',
    `phone` VARCHAR(20) NOT NULL,
    `superseded_at` DATETIME(3) NULL,
    `status` ENUM('DISCONNECTED', 'CONNECTING', 'AWAITING_PAIRING', 'CONNECTED', 'LOGGED_OUT', 'RECONNECTING', 'FAILED', 'EXPIRED', 'AUTHENTICATING') NOT NULL DEFAULT 'DISCONNECTED',
    `retry_count` INTEGER NOT NULL DEFAULT 0,
    `last_connected_at` DATETIME(3) NULL,
    `last_disconnected_at` DATETIME(3) NULL,
    `last_disconnect_code` INTEGER NULL,
    `last_error` TEXT NULL,
    `last_heartbeat_at` DATETIME(3) NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updated_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `isEnabled` BOOLEAN NOT NULL DEFAULT true,

    INDEX `wa_sessions_status_last_heartbeat_at_idx`(`status`, `last_heartbeat_at`),
    INDEX `wa_sessions_phone_superseded_at_idx`(`phone`, `superseded_at`),
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

-- CreateTable
CREATE TABLE `whatsapp_message_inbox` (
    `id` VARCHAR(191) NOT NULL,
    `key` VARCHAR(191) NOT NULL,
    `event` VARCHAR(64) NOT NULL,
    `payload` JSON NOT NULL,
    `reformPayload` JSON NULL,
    `media` JSON NULL,
    `haveMedia` BOOLEAN NOT NULL DEFAULT false,
    `mediaStatus` ENUM('NOT_REQUIRED', 'PENDING', 'PROCESSING', 'UPLOADED', 'FAILED', 'DOWNLOAD_FAILED', 'UPLOAD_FAILED', 'EXHAUSTED') NOT NULL DEFAULT 'NOT_REQUIRED',
    `mediaUploadedAt` DATETIME(3) NULL,
    `mediaAttemptCount` INTEGER NOT NULL DEFAULT 0,
    `mediaNextAttemptAt` DATETIME(3) NULL,
    `mediaLastError` TEXT NULL,
    `mediaLastErrorCode` VARCHAR(128) NULL,
    `mediaLastErrorStage` VARCHAR(32) NULL,
    `mediaProcessingToken` VARCHAR(36) NULL,
    `mediaLeaseExpiresAt` DATETIME(3) NULL,
    `status` ENUM('RECEIVED', 'READY', 'PROCESSING', 'PROCESSED', 'FAILED') NOT NULL DEFAULT 'RECEIVED',
    `sessionId` VARCHAR(191) NOT NULL DEFAULT 'cmw98k683027xdlh6dvvycc7b',
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    UNIQUE INDEX `whatsapp_message_inbox_key_key`(`key`),
    INDEX `whatsapp_message_inbox_status_createdAt_idx`(`status`, `createdAt`),
    INDEX `whatsapp_message_inbox_haveMedia_mediaStatus_updatedAt_idx`(`haveMedia`, `mediaStatus`, `updatedAt`),
    INDEX `whatsapp_message_inbox_mediaStatus_mediaNextAttemptAt_idx`(`mediaStatus`, `mediaNextAttemptAt`),
    INDEX `whatsapp_message_inbox_mediaStatus_mediaLeaseExpiresAt_idx`(`mediaStatus`, `mediaLeaseExpiresAt`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `whatsapp_message_outbox` (
    `id` VARCHAR(191) NOT NULL,
    `inboxId` VARCHAR(191) NOT NULL,
    `payload` JSON NOT NULL,
    `status` ENUM('PENDING', 'PROCESSING', 'PUBLISHED', 'FAILED') NOT NULL DEFAULT 'PENDING',
    `retryCount` INTEGER NOT NULL DEFAULT 0,
    `lastError` TEXT NULL,
    `publishedAt` DATETIME(3) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    UNIQUE INDEX `whatsapp_message_outbox_inboxId_key`(`inboxId`),
    INDEX `whatsapp_message_outbox_status_createdAt_idx`(`status`, `createdAt`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- AddForeignKey
ALTER TABLE `wa_auth_creds` ADD CONSTRAINT `wa_auth_creds_session_id_fkey` FOREIGN KEY (`session_id`) REFERENCES `wa_sessions`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `wa_auth_keys` ADD CONSTRAINT `wa_auth_keys_session_id_fkey` FOREIGN KEY (`session_id`) REFERENCES `wa_sessions`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `wa_session_events` ADD CONSTRAINT `wa_session_events_session_id_fkey` FOREIGN KEY (`session_id`) REFERENCES `wa_sessions`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;
