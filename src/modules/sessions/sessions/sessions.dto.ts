import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import {
  IsIn,
  IsNotEmpty,
  IsOptional,
  IsString,
  MaxLength,
  ValidateIf,
} from 'class-validator';

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
    enum: ['CODE', 'QR'],
    enumName: 'PairingMethod',
    example: 'CODE',
  })
  @IsIn(['CODE', 'QR'])
  pairingMethod: 'CODE' | 'QR';

  @ApiPropertyOptional({
    example: '989121234567',
    maxLength: 30,
    description:
      'Required for CODE, optional for QR. Valid international number with or without +.',
  })
  @ValidateIf(
    (dto: CreateSessionDto) =>
      dto.phone !== undefined || dto.pairingMethod === 'CODE',
  )
  @IsString()
  @MaxLength(30)
  phone?: string;
}

export class PairingCodeDto {
  @ApiPropertyOptional({
    example: '989121234567',
    maxLength: 30,
    description:
      'Omit to reuse the session phone. Required if the session has no phone.',
  })
  @IsOptional()
  @IsString()
  @MaxLength(30)
  phone?: string;
}

export class PairingMethodDto extends PairingCodeDto {
  @ApiProperty({
    enum: ['CODE', 'QR'],
    enumName: 'PairingMethod',
    example: 'CODE',
  })
  @IsIn(['CODE', 'QR'])
  pairingMethod: 'CODE' | 'QR';
}
