import { ApiProperty } from '@nestjs/swagger';
import { IsNotEmpty, IsString, MaxLength } from 'class-validator';

export class UpdateGroupSubjectDto {
  @ApiProperty({
    type: String,
    description: 'Group name / نام گروه؛ بین ۱ تا ۱۰۰ کاراکتر.',
    minLength: 1,
    maxLength: 100,
    example: 'Afra Updated Group',
  })
  @IsString()
  @IsNotEmpty()
  @MaxLength(100)
  subject: string;
}
