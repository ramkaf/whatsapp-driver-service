import type { INestApplication } from '@nestjs/common';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';

export function setupSwagger(app: INestApplication) {
  const options = new DocumentBuilder()
    .setTitle('WhatsApp Session Manager')
    .setDescription(
      'Manage independent WhatsApp sessions using Pairing Code or QR. ' +
        'Click Authorize and paste WA_ADMIN_API_KEY from your environment (without the Bearer prefix). ' +
        'Create a session, retrieve its pairing data, then check runtime.connected in the status endpoint. ' +
        'A returned pairing code is not proof of a connected account.',
    )
    .setVersion('1.0')
    .addBearerAuth(
      {
        type: 'http',
        scheme: 'bearer',
        description:
          'WA_ADMIN_API_KEY. Enter the key only; Swagger adds Bearer automatically.',
      },
      'admin-token',
    )
    .addTag(
      'Sessions',
      'Create, inspect, reconnect, disconnect, log out and delete sessions.',
    )
    .addTag('Pairing', 'Obtain pairing codes or read refreshed raw QR strings.')
    .addTag('Health', 'Application health and aggregate session counts.')
    .build();
  // Keep /docs independent of API_PREFIX. API paths inside the spec retain it.
  const document = SwaggerModule.createDocument(app, options);
  SwaggerModule.setup('docs', app, document, {
    customSiteTitle: 'WhatsApp API',
    swaggerOptions: {
      persistAuthorization: false,
      displayRequestDuration: true,
      docExpansion: 'none',
    },
  });
  return document;
}
