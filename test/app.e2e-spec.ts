import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { App } from 'supertest/types.js';
import { AppModule } from './../src/app.module.js';
import { PrismaService } from '@libs/prisma';
import { RedisService } from '../libs/common/src/redis/index.ts';
import { vi } from 'vitest';

describe('AppController (e2e)', () => {
  let app: INestApplication<App>;

  beforeEach(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    })
      .overrideProvider(PrismaService)
      .useValue({
        $queryRaw: vi.fn().mockResolvedValue([{ message: 'Hello World!' }]),
      })
      .overrideProvider(RedisService)
      .useValue({ client: {} })
      .compile();

    app = moduleFixture.createNestApplication();
    await app.init();
  });

  it.each(['/', '/hi'])('%s (GET)', async (path) => {
    await request(app.getHttpServer())
      .get(path)
      .expect(200)
      .expect([{ message: 'Hello World!' }]);
  });

  afterEach(async () => {
    await app.close();
  });
});
