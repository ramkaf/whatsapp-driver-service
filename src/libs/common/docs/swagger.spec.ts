import 'reflect-metadata';
import { Module } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { createSwaggerDocument } from './swagger.ts';
import { WhatsappConnectController } from '../../../whatsapp/connection/controllers/whatsap-connect.controller.ts';
import { WhatsappConnectService } from '../../../whatsapp/connection/providers/wa-connect.service.ts';
import { WhatsappConnectionGuard } from '../../../whatsapp/connection/guards/whatsapp-connection.guard.ts';
import { WhatsappGroupController } from '../../../whatsapp/groups/controllers/whatsapp-group.controller.ts';
import { WhatsappGroupService } from '../../../whatsapp/groups/providers/whatsapp-group.service.ts';

@Module({
  controllers: [WhatsappConnectController, WhatsappGroupController],
  providers: [
    { provide: WhatsappConnectService, useValue: {} },
    { provide: WhatsappGroupService, useValue: {} },
    WhatsappConnectionGuard,
  ],
})
class DocumentationModule {}

it('documents every HTTP operation with responses, group parameters and request bodies', async () => {
  // No production modules or bootstrap hooks: no WhatsApp connection is opened.
  const app = await NestFactory.create(DocumentationModule, { logger: false });
  try {
    app.setGlobalPrefix('api/v1');
    const document = createSwaggerDocument(app);
    let operations = 0;
    for (const [path, item] of Object.entries(document.paths)) {
      for (const method of ['get', 'post', 'patch', 'delete'] as const) {
        const operation = item?.[method];
        if (!operation) continue;
        operations++;
        expect(path).toMatch(/^\/api\/v1\/whatsapp\//);
        expect(operation.summary).toBeTruthy();
        const status = method === 'post' ? '201' : '200';
        expect(operation.responses[status]).toHaveProperty(
          'content.application/json.schema',
        );
        if (path.includes('{groupJid}')) {
          expect(operation.parameters).toEqual(
            expect.arrayContaining([
              expect.objectContaining({
                name: 'groupJid',
                in: 'path',
                required: true,
              }),
            ]),
          );
        }
        if (path.includes('/groups')) {
          expect(operation.responses['503']).toBeDefined();
          expect(operation.responses['502']).toBeDefined();
        }
      }
    }
    expect(operations).toBe(18);
    expect(
      document.paths['/api/v1/whatsapp/groups']?.post?.requestBody,
    ).toHaveProperty(
      'content.application/json.schema.$ref',
      '#/components/schemas/CreateGroupDto',
    );
    expect(
      document.paths['/api/v1/whatsapp/groups/{groupJid}/participants']?.delete
        ?.requestBody,
    ).toBeDefined();
    expect(
      document.components?.schemas?.GroupParticipantRoleDto,
    ).toHaveProperty('properties.participants');
    expect(
      document.components?.schemas?.GroupParticipantRoleDto,
    ).toHaveProperty('properties.action.enum', ['promote', 'demote']);
    expect(
      document.components?.securitySchemes?.['whatsapp-token'],
    ).toMatchObject({
      type: 'http',
      scheme: 'bearer',
    });
    expect(document.security).toEqual([{ 'whatsapp-token': [] }]);
  } finally {
    await app.close();
  }
});

it('documents the authenticated reset operation and the correct QR endpoint', async () => {
  const app = await NestFactory.create(DocumentationModule, { logger: false });
  try {
    app.setGlobalPrefix('api/v1');
    const document = createSwaggerDocument(app);
    const reset =
      document.paths['/api/v1/whatsapp/connection/reset-session']?.post;
    expect(reset?.security).toEqual([{ 'whatsapp-token': [] }]);
    expect(reset?.responses['201']).toHaveProperty(
      'content.application/json.schema.properties.qrEndpoint.example',
      '/api/v1/whatsapp/connection/qr',
    );
    expect(reset?.responses['401']).toBeDefined();
    expect(reset?.responses['503']).toBeDefined();
  } finally {
    await app.close();
  }
});
