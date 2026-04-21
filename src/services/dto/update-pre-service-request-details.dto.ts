import {
  IsDateString,
  IsIn,
  IsNotEmpty,
  IsOptional,
  IsString,
  MaxLength,
} from 'class-validator';

export class UpdatePreServiceRequestDetailsDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(200)
  address: string;

  @IsOptional()
  @IsString()
  @MaxLength(120)
  city?: string;

  @IsDateString()
  scheduled_at: string;

  @IsIn(['low', 'medium', 'high'])
  urgency_level: 'low' | 'medium' | 'high';

  @IsOptional()
  @IsString()
  @MaxLength(120)
  title?: string;

  @IsOptional()
  @IsString()
  @MaxLength(500)
  description?: string;
}
