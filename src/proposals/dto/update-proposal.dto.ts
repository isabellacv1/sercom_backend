import {
  IsNumber,
  IsOptional,
  IsString,
  MaxLength,
  Min,
  MinLength,
} from 'class-validator';

export class UpdateProposalDto {
  @IsOptional()
  @IsNumber()
  @Min(0)
  price?: number;

  @IsOptional()
  @IsString()
  @MinLength(20)
  @MaxLength(500)
  message?: string;

  @IsOptional()
  @IsString()
  estimated_duration?: string;
}
