import type { INestApplication } from '@nestjs/common';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';

export function createSwaggerDocument(app: INestApplication) {
  const config = new DocumentBuilder()
    .setTitle('WhatsApp Service API')
    .setDescription(
      'راهنمای API واتساپ: ابتدا اتصال را برقرار کنید، سپس وضعیت یا QR را دریافت کنید. مسیرهای گروه به اتصال فعال نیاز دارند. برای ارسال توکن در همه درخواست‌ها، دکمه Authorize را بزنید و توکن را بدون پیشوند Bearer وارد کنید. پایش پیام‌ها و ری‌اکشن‌ها از طریق رویدادهای سوکت انجام می‌شود و endpoint HTTP ندارد.\n\n' +
        'Manage WhatsApp pairing and groups. All API routes start with /api/v1. ' +
        'Start with POST /api/v1/whatsapp/connection/connect, then poll GET /api/v1/whatsapp/connection/status or GET /api/v1/whatsapp/connection/qr. ' +
        'Saved sessions reconnect without generating a QR. Group endpoints require an authenticated WhatsApp connection and return 503 otherwise. ' +
        'Use Authorize to enter your token without the Bearer prefix; Swagger sends it in the Authorization header for all API requests. POST /api/v1/whatsapp/connection/reset-session enforces WHATSAPP_API_TOKEN and archives credentials before starting a fresh pairing session. / ریست نشست به توکن معتبر سرور نیاز دارد؛ پس از ریست باید QR جدید با گوشی اسکن شود. Other endpoints retain their existing authentication behavior. Message monitoring and reactions run through socket events and have no HTTP endpoints.',
    )
    .setVersion('1.0')
    .addBearerAuth(
      {
        type: 'http',
        scheme: 'bearer',
        description:
          'Enter the token without the Bearer prefix. / توکن را بدون پیشوند Bearer وارد کنید.',
      },
      'whatsapp-token',
    )
    .addSecurityRequirements('whatsapp-token')
    .addTag(
      'WhatsApp Connection',
      'Pairing QR and connection lifecycle / اتصال، وضعیت و کد QR',
    )
    .addTag(
      'WhatsApp Groups',
      'Group metadata, participants, roles and invitations / اطلاعات گروه، اعضا، نقش‌ها و دعوت‌نامه‌ها',
    )
    .build();
  return SwaggerModule.createDocument(app, config);
}

export function setupSwagger(app: INestApplication) {
  const document = createSwaggerDocument(app);
  SwaggerModule.setup('docs', app, document, {
    jsonDocumentUrl: 'docs-json',
    swaggerOptions: {
      persistAuthorization: false,
      displayRequestDuration: true,
    },
    customSiteTitle: 'WhatsApp Service API',
  });
}
