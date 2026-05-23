import { IsOptional, IsString, MaxLength } from 'class-validator';

export class ReleasePaymentDto {
  @IsOptional()
  @IsString()
  @MaxLength(500)
  note?: string;
}
