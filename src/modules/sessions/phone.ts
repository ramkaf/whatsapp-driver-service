import { BadRequestException } from '@nestjs/common';
import { parsePhoneNumberFromString } from 'libphonenumber-js/max';

export function normalizePhone(value: string): string {
  const phone = parsePhoneNumberFromString(
    value.startsWith('+') ? value : `+${value}`,
  );
  if (!phone?.isValid())
    throw new BadRequestException(
      'A valid international phone number is required',
    );
  return phone.number.slice(1);
}
