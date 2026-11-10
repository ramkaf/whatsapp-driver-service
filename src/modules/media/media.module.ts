import { Module } from '@nestjs/common';
import { MediaController } from './controllers/media.controller.ts';
import { MediaService } from './providers/media.service.ts';
import { MinioStorageService } from './providers/minio-storage.service.ts';

@Module({
  controllers: [MediaController],
  providers: [MediaService, MinioStorageService],
  exports: [MediaService],
})
export class MediaModule {}
