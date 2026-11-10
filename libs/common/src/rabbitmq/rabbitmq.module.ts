import { Module } from '@nestjs/common';
import type {
  DynamicModule,
  FactoryProvider,
  ModuleMetadata,
} from '@nestjs/common';
import { RabbitMQService } from './rabbitmq.service.ts';
import type { RabbitMQOptions } from './common/interface/index.ts';

export const RABBITMQ_OPTIONS = Symbol('RABBITMQ_OPTIONS');
@Module({})
export class RabbitMQModule {
  /** Register once in the application root; the exported provider is singleton. */
  static forRoot(options: RabbitMQOptions): DynamicModule {
    return {
      module: RabbitMQModule,
      global: true,
      providers: [
        {
          provide: RabbitMQService,
          useFactory: () => new RabbitMQService(options),
        },
      ],
      exports: [RabbitMQService],
    };
  }
  static forRootAsync(
    options: Pick<ModuleMetadata, 'imports'> &
      Pick<FactoryProvider<RabbitMQOptions>, 'inject' | 'useFactory'>,
  ): DynamicModule {
    return {
      module: RabbitMQModule,
      global: true,
      imports: options.imports,
      providers: [
        {
          provide: RABBITMQ_OPTIONS,
          useFactory: options.useFactory,
          inject: options.inject,
        },
        {
          provide: RabbitMQService,
          inject: [RABBITMQ_OPTIONS],
          useFactory: (config: RabbitMQOptions) => new RabbitMQService(config),
        },
      ],
      exports: [RabbitMQService],
    };
  }
}
