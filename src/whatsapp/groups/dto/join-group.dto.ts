import { ApiProperty } from '@nestjs/swagger';
import { IsString, Matches } from 'class-validator';

export class JoinGroupDto {
  @ApiProperty({
    type: String,
    pattern: '^[A-Za-z0-9_-]{10,128}$',
    example: 'AbCdEfGhIjKlMnOpQrStUv',
    description:
      'WhatsApp group invite code, not the full URL / کد دعوت گروه؛ لینک کامل را وارد نکنید.',
  })
  @IsString()
  @Matches(/^[A-Za-z0-9_-]{10,128}$/)
  code: string;
}
