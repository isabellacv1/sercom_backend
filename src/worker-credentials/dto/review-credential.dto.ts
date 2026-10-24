import { IsIn, IsOptional, IsString, MaxLength } from 'class-validator';

export class ReviewCredentialDto {
  @IsIn(['verified', 'rejected'])
  status: 'verified' | 'rejected';

  @IsOptional()
  @IsString()
  @MaxLength(300)
  note?: string;
}
