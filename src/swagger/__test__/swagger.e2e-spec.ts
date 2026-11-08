import { Test } from '@nestjs/testing';
import request from 'supertest';
import { SessionsController } from '../../modules/sessions/controllers/sessions.controller.ts';
import { SessionsService } from '../../modules/sessions/providers/sessions.service.ts';
import { PairingService } from '../../modules/pairing/providers/pairing.service.ts';
import { HealthController } from '../../modules/monitoring/controllers/health.controller.ts';
import { AdminGuard } from '../../modules/sessions/guards/admin.guard.ts';
import { setupSwagger } from '../setup-swagger.ts';

describe('Swagger (e2e)', () => {
  it.each(['', 'api'])(
    'serves docs and documents real API paths with prefix %j',
    async (prefix) => {
      const module = await Test.createTestingModule({
        controllers: [SessionsController, HealthController],
        providers: [
          { provide: SessionsService, useValue: { list: async () => [] } },
          { provide: PairingService, useValue: {} },
        ],
      })
        .overrideGuard(AdminGuard)
        .useValue({ canActivate: () => true })
        .compile();
      const app = module.createNestApplication();
      app.setGlobalPrefix(prefix);
      const document = setupSwagger(app);
      await app.init();
      try {
        const base = prefix ? `/${prefix}` : '';
        expect(Object.keys(document.paths)).toHaveLength(8);
        expect(document.paths[`${base}/sessions/{id}/status`]).toBeUndefined();
        expect(
          document.paths[`${base}/sessions/{id}/pairing-method`],
        ).toBeUndefined();
        expect(document.components!.schemas!.PairingMethodDto).toBeUndefined();
        expect(document.paths[`${base}/sessions`]!.get!.security).toEqual([
          { 'admin-token': [] },
        ]);
        expect(document.paths[`${base}/health`]!.get!.security).toEqual([
          { 'admin-token': [] },
        ]);
        expect(
          document.components!.securitySchemes!['admin-token'],
        ).toMatchObject({ type: 'http', scheme: 'bearer' });
        const body = document.paths[`${base}/sessions`]!.post!.requestBody;
        expect(body).toHaveProperty(
          'content.application/json.examples.code.value.pairingMethod',
          'CODE',
        );
        expect(body).toHaveProperty(
          'content.application/json.examples.qr.value.pairingMethod',
          'QR',
        );
        expect(document.components!.schemas!.SessionResponseDto).toHaveProperty(
          'properties.runtime',
        );
        expect(
          document.components!.schemas!.SessionResponseDto,
        ).not.toHaveProperty('properties.authCreds');
        expect(
          document.components!.schemas!.SessionResponseDto,
        ).not.toHaveProperty('properties.authKeys');
        expect(
          document.paths[`${base}/sessions/{id}`]!.delete!.responses,
        ).toHaveProperty('204');
        expect(
          document.paths[`${base}/sessions/{id}/pairing-code`]!.post!.responses,
        ).toHaveProperty('429');
        expect(
          document.paths[`${base}/sessions`]!.get!.parameters ?? [],
        ).toHaveLength(0);
        const ui = await request(app.getHttpServer()).get('/docs/').expect(200);
        expect(ui.text).toContain('swagger-ui');
        const json = await request(app.getHttpServer())
          .get('/docs-json')
          .expect(200);
        expect(json.body.paths).toHaveProperty(`${base}/sessions`);
        await request(app.getHttpServer())
          .get(`${base}/sessions`)
          .expect(200)
          .expect([]);
      } finally {
        await app.close();
      }
    },
  );
});
