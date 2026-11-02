import { ApiProperty } from '@nestjs/swagger';
import { IsString, MaxLength } from 'class-validator';

export class UpdateGroupDescriptionDto {
  @ApiProperty({
    type: String,
    description:
      'Group description / توضیحات گروه؛ حداکثر ۲۰۴۸ کاراکتر. متن خالی برای پاک کردن توضیحات.',
    maxLength: 2048,
    example: 'Internal coordination group',
  })
  @IsString()
  @MaxLength(2048)
  description: string;
}
