import { BadRequestException } from "@nestjs/common";

export function normalizePhoneNumber(phone: string): string {
  let normalized = phone.replace(/\D/g, '');

  // Convert 0098 to 98
  if (normalized.startsWith('0098')) {
    normalized = normalized.slice(2);
  }

  // Convert Iranian local number to international format
  if (normalized.startsWith('09') && normalized.length === 11) {
    normalized = `98${normalized.slice(1)}`;
  }

  if (
    normalized.length < 8 ||
    normalized.length > 15 ||
    normalized.startsWith('0')
  ) {
    throw new BadRequestException(
      `Invalid phone number: ${phone}`,
    );
  }

  return normalized;
}