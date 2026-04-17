import {
  IsDateString,
  IsNotEmpty,
  IsNumber,
  IsOptional,
  IsString,
  IsUUID,
  Min,
} from 'class-validator';

export class CreateServiceAssignmentDto {
  @IsUUID()
  @IsNotEmpty()
  serviceId!: string;

  @IsNumber()
  @Min(0)
  proposedPrice!: number;

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
