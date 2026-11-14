import {
  DynamicModule,
  FactoryProvider,
  Module,
  ModuleMetadata,
} from '@nestjs/common';

import { REDIS_OPTIONS, type RedisOptions } from './redis.types.ts';
import { ClientRedis } from './services/client.service.ts';
import { RedisConnectionsService } from './services/redis-connections.service.ts';
import { CLIENT_REDIS, REDIS_CONNECTIONS } from './interface/index.ts';

const redisProviders = [
  RedisConnectionsService,
  { provide: REDIS_CONNECTIONS, useExisting: RedisConnectionsService },
  ClientRedis,
  { provide: CLIENT_REDIS, useExisting: ClientRedis },
];

type RedisAsyncOptions = Pick<ModuleMetadata, 'imports'> &
  Pick<FactoryProvider<RedisOptions>, 'inject' | 'useFactory'>;

@Module({})
export class RedisModule {
  static forRoot(options: RedisOptions): DynamicModule {
    return {
      module: RedisModule,
      global: true,
      providers: [
        {
          provide: REDIS_OPTIONS,
          useValue: options,
        },
        ...redisProviders,
      ],
      exports: [REDIS_OPTIONS, REDIS_CONNECTIONS, CLIENT_REDIS],
    };
  }

  static forRootAsync(options: RedisAsyncOptions): DynamicModule {
    return {
      module: RedisModule,
      global: true,
      imports: options.imports,
      providers: [
        {
          provide: REDIS_OPTIONS,
          useFactory: options.useFactory,
          inject: options.inject,
        },
        ...redisProviders,
      ],
      exports: [REDIS_OPTIONS, REDIS_CONNECTIONS, CLIENT_REDIS],
    };
  }
}
