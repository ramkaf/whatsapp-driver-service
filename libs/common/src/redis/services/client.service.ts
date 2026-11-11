import { Inject, Injectable } from '@nestjs/common';
import { BaseRedis } from './base.service.ts';
import {
  REDIS_CONNECTIONS,
  type IClientRedis,
  type RedisConnections,
} from '../interface/index.ts';

@Injectable()
export class ClientRedis extends BaseRedis implements IClientRedis {
  constructor(@Inject(REDIS_CONNECTIONS) connections: RedisConnections) {
    super(connections, { ttlMs: null });
  }
}
