import { ApiProperty } from '@nestjs/swagger';
import { IsString, Matches } from 'class-validator';

export class GroupJidParamDto {
  @ApiProperty({
    description: 'WhatsApp group JID',
    example: '120363430140113232@g.us',
  })
  @IsString()
  @Matches(/^\d+@g\.us$/, {
    message: 'groupJid must be a valid WhatsApp group JID',
  })
  groupJid: string;
}
