import { IsOptional, IsString, IsUUID, MaxLength } from 'class-validator';

export class CreatePreServiceRequestDto {
  @IsUUID()
  category_id: string;

  @IsOptional()
  @IsString()
  @MaxLength(120)
  title?: string;
}
