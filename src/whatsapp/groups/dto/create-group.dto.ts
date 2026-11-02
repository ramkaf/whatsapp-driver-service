import { ApiProperty } from '@nestjs/swagger';
import {
  ArrayMinSize,
  ArrayUnique,
  IsArray,
  IsNotEmpty,
  IsString,
  MaxLength,
  Matches,
} from 'class-validator';

export class CreateGroupDto {
  @ApiProperty({
    type: String,
    description: 'Group name / نام گروه؛ بین ۱ تا ۱۰۰ کاراکتر.',
    minLength: 1,
    maxLength: 100,
    example: 'Afra Group',
  })
  @IsString()
  @IsNotEmpty()
  @MaxLength(100)
  subject: string;

  @ApiProperty({
    example: ['989121234567@s.whatsapp.net'],
    type: [String],
    minItems: 1,
    uniqueItems: true,
    description:
      'Participant phone JIDs, for example 989121234567@s.whatsapp.net. / فهرست شناسه‌های شماره اعضا با پسوند @s.whatsapp.net؛ حداقل یک عضو و بدون تکرار.',
  })
  @IsArray()
  @ArrayMinSize(1)
  @ArrayUnique()
  @Matches(/^\d+@s\.whatsapp\.net$/, { each: true })
  participants: string[];
}
