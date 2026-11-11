import { Inject, Injectable, Logger } from '@nestjs/common';
import { CLIENT_REDIS, type IClientRedis } from '@libs/common';

@Injectable()
export class AppService {
  private readonly logger = new Logger(AppService.name);

  constructor(@Inject(CLIENT_REDIS) protected redis: IClientRedis) {
    this.redis = this.redis.setPrefix('admin');
  }

  // Example only: this method is not called automatically.
  async redisExample(db: number) {
    await this.redis.set('name', 'sajjad');
    await this.redis.set('code', '256', { db, ttlMs: 10000 });
    const name = await this.redis.get('name');
    if (await this.redis.exists('code', { db }))
      await this.redis.del('code', { db });

    await this.redis.hset('user:1', 'name', 'sajjad', { db });
    const userName = await this.redis.hget('user:1', 'name', { db });
    await this.redis.hdel('user:1', 'name', { db });

    await this.redis.rpush('jobs', 'job-1', { db });
    const jobs = await this.redis.lrange('jobs', 0, -1, { db });

    await this.redis.zadd('scores', 80, 'user-1', { db });
    await this.redis.zadd('scores', 95, 'user-2', { db });
    const filtered = await this.redis.zrangeByScore('scores', 80, 100, { db });
    const ascending = await this.redis.zrange('scores', 0, -1, { db });
    const descending = await this.redis.zrevrange('scores', 0, -1, { db });

    const now = Date.now();
    await this.redis.zadd('events', now, 'event-1', { db });
    const recentEvents = await this.redis.zrangeByScore(
      'events',
      now - 60_000,
      now,
      { db },
    );
    return {
      name,
      userName,
      jobs,
      filtered,
      ascending,
      descending,
      recentEvents,
    };
  }
  async getHello(): Promise<string> {
    this.logger.debug('Handling getHello request', await this.redisExample(1));
    return 'Hello World!';
  }
}
