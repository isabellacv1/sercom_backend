import { IsNotEmpty, IsNumber, IsOptional, IsString, IsUUID, MaxLength, Min, MinLength } from 'class-validator';

export class CreateProposalDto {
  @IsUUID()
  @IsNotEmpty()
  service_id: string;

  @IsNumber()
  @Min(0)
  price: number;

  @IsString()
  @IsNotEmpty()
  @MinLength(20)
  @MaxLength(500)
  message: string;

  @IsString()
  @IsOptional()
  estimated_duration?: string;
}
