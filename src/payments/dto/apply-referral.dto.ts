import { IsNotEmpty, IsString, MaxLength } from 'class-validator';

export class ApplyReferralDto {
  @IsString()
  @IsNotEmpty({ message: 'Escribe el código de invitación' })
  @MaxLength(20)
  code: string;
}
