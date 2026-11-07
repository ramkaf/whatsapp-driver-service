import { BadRequestException } from '@nestjs/common';
import { parsePhoneNumberFromString } from 'libphonenumber-js/max';
import { ValidateBy } from 'class-validator';

export const IsInternationalPhone = () =>
  ValidateBy({
    name: 'isInternationalPhone',
    validator: {
      validate(value: unknown) {
        if (typeof value !== 'string') return false;
        try {
          normalizePhone(value);
          return true;
        } catch {
          return false;
        }
      },
      defaultMessage: () =>
        'phone must be a valid international phone number with country code',
    },
  });

export function normalizePhone(value: string): string {
  value = value.trim();
  if (!/^\+?[\d\s().-]+$/.test(value))
    throw new BadRequestException(
      'A valid international phone number is required',
    );
  const phone = parsePhoneNumberFromString(
    value.startsWith('+') ? value : `+${value}`,
  );
  if (!phone?.isValid())
    throw new BadRequestException(
      'A valid international phone number is required',
    );
  return phone.number.slice(1);
}
