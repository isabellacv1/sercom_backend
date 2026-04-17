import {
  IsDateString,
  IsNotEmpty,
  IsNumber,
  IsOptional,
  IsString,
  IsUUID,
  MaxLength,
  Min,
} from 'class-validator';

export class CreateServiceAssignmentDto {
  @IsUUID()
  @IsNotEmpty()
  serviceId!: string;

  @IsNumber()
  @Min(0)
  proposedPrice!: number;

  @IsString()
  @IsNotEmpty()
  @MaxLength(500)
  serviceDescription!: string;

  @IsNumber()
  @Min(1)
  estimatedTimeMinutes!: number;

  @IsOptional()
  @IsNumber()
  @Min(0)
  distanceKm?: number;

  @IsDateString()
  availableDate!: string;

  @IsString()
  @IsNotEmpty()
  availableFrom!: string;

  @IsString()
  @IsNotEmpty()
  availableTo!: string;
}
