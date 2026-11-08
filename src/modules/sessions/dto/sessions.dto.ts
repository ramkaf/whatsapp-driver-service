import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import {
  IsEnum,
  IsNotEmpty,
  IsString,
  MaxLength,
  ValidateIf,
} from 'class-validator';
import { IsInternationalPhone } from '../phone.ts';
import { PairingMethodEnum } from '../interfaces/session.interface.ts';

export class CreateSessionDto {
  @ApiProperty({ example: 'WhatsApp 01', minLength: 1, maxLength: 100 })
  @Transform(({ value }: { value: unknown }) =>
    typeof value === 'string' ? value.trim() : value,
  )
  @IsString()
  @IsNotEmpty()
  @MaxLength(100)
  name: string;

  @ApiProperty({
    enum: PairingMethodEnum,
    enumName: 'PairingMethod',
    example: PairingMethodEnum.CODE,
  })
  @IsEnum(PairingMethodEnum)
  pairingMethod: PairingMethodEnum;

  @ApiPropertyOptional({
    example: '989121234567',
    maxLength: 30,
    description:
      'Required for CODE, optional for QR. Valid international number with or without +.',
  })
  @ValidateIf(
    (dto: CreateSessionDto) =>
      dto.phone !== undefined || dto.pairingMethod === PairingMethodEnum.CODE,
  )
  @IsString()
  @MaxLength(30)
  @IsInternationalPhone()
  phone?: string;
}

export class PairingCodeDto {
  @ApiPropertyOptional({
    example: '989121234567',
    maxLength: 30,
    description:
      'Omit to reuse the session phone. Required if the session has no phone.',
  })
  @ValidateIf((_dto, value: unknown) => value !== undefined)
  @IsString()
  @MaxLength(30)
  @IsInternationalPhone()
  phone: string;
}
