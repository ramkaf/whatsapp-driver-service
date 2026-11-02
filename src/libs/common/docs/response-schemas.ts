import type { SchemaObject } from '@nestjs/swagger';
import { SessionStatus } from '../../../whatsapp/connection/enum/session-status.enum.ts';

const text: SchemaObject = { type: 'string' };
const nullableText: SchemaObject = { ...text, nullable: true };
const count: SchemaObject = { type: 'integer', minimum: 0 };
const boolean: SchemaObject = { type: 'boolean' };
export const groupJidSchema: SchemaObject = {
  type: 'string',
  example: '120363123456789@g.us',
  description:
    'WhatsApp group JID, including the @g.us suffix (not a UUID). / شناسه گروه واتساپ با پسوند @g.us؛ این مقدار UUID نیست.',
};
function object(properties: Record<string, SchemaObject>): SchemaObject {
  return { type: 'object', required: Object.keys(properties), properties };
}
function array(items: SchemaObject): SchemaObject {
  return { type: 'array', items };
}

export const sessionSchema = object({
  status: {
    type: 'string',
    enum: Object.values(SessionStatus),
    example: 'connected',
    description:
      'Session state / وضعیت نشست: قطع، در حال اتصال، منتظر QR، متصل، خروج از حساب یا خطا.',
  },
  accountJid: {
    ...nullableText,
    example: '989121234567:1@s.whatsapp.net',
    description: 'Connected account JID / شناسه حساب متصل.',
  },
  qrAvailable: {
    ...boolean,
    description: 'QR availability / آیا QR اتصال در دسترس است؟',
  },
  hasSavedSession: {
    ...boolean,
    description: 'Saved session availability / آیا نشست ذخیره‌شده وجود دارد؟',
  },
  lastDisconnectCode: {
    type: 'integer',
    nullable: true,
    example: 401,
    description: 'Last disconnect code / کد آخرین قطع اتصال.',
  },
  qrUnavailableReason: {
    ...nullableText,
    example: 'WhatsApp is already connected.',
    description: 'Reason QR is unavailable / دلیل در دسترس نبودن QR.',
  },
  qrEndpoint: {
    ...text,
    example: '/api/v1/whatsapp/connection/qr',
    description: 'Pairing QR endpoint / مسیر دریافت کد QR اتصال.',
  },
});
export const qrSchema = object({
  ...sessionSchema.properties,
  qr: {
    ...nullableText,
    description:
      'Raw pairing QR payload; null when unavailable or expired. / محتوای خام QR اتصال؛ اگر موجود نباشد یا منقضی شود null است.',
  },
  qrDataUrl: {
    ...nullableText,
    example: 'data:image/png;base64,...',
    description:
      'PNG data URL suitable for an image src; null when unavailable. / آدرس داده تصویر PNG برای نمایش در تگ تصویر؛ اگر موجود نباشد null است.',
  },
});
export const errorSchema = object({
  statusCode: { type: 'integer', example: 502 },
  error: { ...text, example: 'Bad Gateway' },
  message: { ...text, example: 'WhatsApp failed to fetch group details' },
});
export const disconnectedSchema = object({
  statusCode: { type: 'integer', example: 503 },
  error: { ...text, example: 'WHATSAPP_NOT_CONNECTED' },
  message: { ...text, example: 'WhatsApp connection is not available' },
  connectionStatus: { type: 'string', enum: Object.values(SessionStatus) },
});
export const groupSchema = object({
  id: groupJidSchema,
  name: {
    ...text,
    example: 'Afra Group',
    description: 'Group name / نام گروه.',
  },
  description: {
    ...nullableText,
    description: 'Group description / توضیحات گروه.',
  },
  owner: { ...nullableText, description: 'Group owner JID / شناسه مالک گروه.' },
  participantsCount: {
    ...count,
    description: 'Participant count / تعداد اعضای گروه.',
  },
  announcementOnly: {
    ...boolean,
    description:
      'Only admins can send messages / فقط مدیران امکان ارسال پیام دارند.',
  },
  adminsOnlySettings: {
    ...boolean,
    description:
      'Only admins can edit group settings / فقط مدیران امکان تغییر تنظیمات گروه دارند.',
  },
  createdAt: {
    type: 'integer',
    nullable: true,
    description:
      'Unix timestamp in seconds. / زمان ایجاد گروه به صورت تعداد ثانیه از مبدأ یونیکس.',
  },
});
const participantSchema = object({
  id: { ...text, example: '123456789@lid' },
  admin: {
    type: 'string',
    enum: ['admin', 'superadmin'],
    nullable: true,
    description:
      'null for ordinary members. / نقش عضو در گروه؛ برای اعضای عادی null است.',
  },
});
export const participantsSchema = object({
  groupJid: groupJidSchema,
  total: { ...count, description: 'Total participants / تعداد کل اعضا.' },
  participants: array({
    ...participantSchema,
    properties: {
      ...participantSchema.properties,
      phoneNumer: {
        ...text,
        description:
          'Legacy field name. Phone JID, when provided by WhatsApp. / نام فعلی این فیلد در API؛ شناسه شماره تلفن، در صورت ارائه توسط واتساپ.',
      },
    },
  }),
});
export const groupInfoSchema = object({
  id: groupJidSchema,
  name: { ...text, description: 'Group name / نام گروه.' },
  description: {
    ...nullableText,
    description: 'Group description / توضیحات گروه.',
  },
  owner: { ...nullableText, description: 'Group owner JID / شناسه مالک گروه.' },
  participantsCount: {
    ...count,
    description: 'Participant count / تعداد اعضای گروه.',
  },
  participants: array(
    object({
      ...participantSchema.properties,
      lid: { ...nullableText, description: 'WhatsApp LID / شناسه LID عضو.' },
      phoneNumber: {
        ...nullableText,
        example: '989121234567@s.whatsapp.net',
        description:
          'Phone JID when available / شناسه شماره عضو در صورت دسترسی.',
      },
      username: {
        ...nullableText,
        description: 'Username when available / نام کاربری عضو در صورت دسترسی.',
      },
    }),
  ),
});
export const createdGroupSchema = object({
  id: groupJidSchema,
  name: { ...text, description: 'Group name / نام گروه.' },
  participantsCount: {
    ...count,
    description: 'Participant count / تعداد اعضای گروه.',
  },
});
export const joinedGroupSchema = object({
  groupJid: { ...groupJidSchema, nullable: true },
});
export const subjectSchema = object({
  groupJid: groupJidSchema,
  subject: { ...text, description: 'Updated group name / نام جدید گروه.' },
  updated: {
    type: 'boolean',
    example: true,
    description: 'Update completed / تغییرات اعمال شد.',
  },
});
export const descriptionSchema = object({
  groupJid: groupJidSchema,
  description: {
    ...text,
    description: 'Updated group description / توضیحات جدید گروه.',
  },
  updated: {
    type: 'boolean',
    example: true,
    description: 'Update completed / تغییرات اعمال شد.',
  },
});
export const inviteSchema = object({
  groupJid: groupJidSchema,
  code: {
    ...nullableText,
    example: 'AbCdEfGhIjKlMnOpQrStUv',
    description: 'Group invite code / کد دعوت گروه.',
  },
  inviteUrl: {
    ...nullableText,
    example: 'https://chat.whatsapp.com/AbCdEfGhIjKlMnOpQrStUv',
    description: 'Group invite URL / لینک دعوت گروه.',
  },
});
export const leaveSchema = object({
  groupJid: groupJidSchema,
  left: {
    type: 'boolean',
    example: true,
    description: 'Left the group / حساب متصل از گروه خارج شد.',
  },
});
export const participantUpdateSchema = array({
  type: 'object',
  required: ['status', 'content'],
  properties: {
    status: {
      ...text,
      example: '200',
      description:
        'Per-participant WhatsApp result code. An HTTP success does not guarantee that each member operation succeeded. / کد نتیجه واتساپ برای هر عضو؛ پاسخ موفق HTTP به معنی موفقیت عملیات برای همه اعضا نیست.',
    },
    jid: { ...text, example: '989121234567@s.whatsapp.net' },
    content: {
      type: 'object',
      additionalProperties: true,
      description:
        'Raw Baileys BinaryNode response; structure varies by WhatsApp result. / پاسخ خام Baileys؛ ساختار آن بر اساس نتیجه واتساپ متفاوت است.',
    },
  },
});
export const groupsSchema = array(groupSchema);
