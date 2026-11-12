import { Module } from '@nestjs/common';
import type {
  DynamicModule,
  FactoryProvider,
  ModuleMetadata,
} from '@nestjs/common';
import { MINIO_STORAGE } from './interfaces/index.ts';
import { MinioConnectionService } from './services/minio-connection.service.ts';
import { MinioStorageService } from './services/minio.service.ts';
import { MINIO_OPTIONS, type MinioOptions } from './minio.types.ts';

export type MinioAsyncOptions = Pick<ModuleMetadata, 'imports'> &
  Pick<FactoryProvider<MinioOptions>, 'inject' | 'useFactory'>;

const providers = [
  MinioConnectionService,
  MinioStorageService,
  { provide: MINIO_STORAGE, useExisting: MinioStorageService },
];

@Module({})
export class MinioModule {
  static forRoot(options: MinioOptions): DynamicModule {
    return {
      module: MinioModule,
      global: true,
      providers: [{ provide: MINIO_OPTIONS, useValue: options }, ...providers],
      exports: [MINIO_OPTIONS, MINIO_STORAGE],
    };
  }

  static forRootAsync(options: MinioAsyncOptions): DynamicModule {
    return {
      module: MinioModule,
      global: true,
      imports: options.imports,
      providers: [
        {
          provide: MINIO_OPTIONS,
          useFactory: options.useFactory,
          inject: options.inject,
        },
        ...providers,
      ],
      exports: [MINIO_OPTIONS, MINIO_STORAGE],
    };
  }
}
