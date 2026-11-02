import { ApiProperty } from '@nestjs/swagger';
import { ArrayMinSize, ArrayUnique, IsArray, Matches } from 'class-validator';

export class GroupParticipantsDto {
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
