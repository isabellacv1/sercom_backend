import {
  IsString,
  IsOptional,
  MaxLength,
  IsArray,
  ArrayMinSize,
  ValidateNested,
  IsIn,
  IsUUID,
  IsInt,
  IsNumber,
  Min,
} from 'class-validator';
import { Type } from 'class-transformer';
 
export const VALID_ZONE_IDS = [
  'norte',
  'nororiente',
  'centro',
  'oriente',
  'ladera',
  'sur',
  'suroccidente',
] as const;
 
export type ZoneId = (typeof VALID_ZONE_IDS)[number];
 
export const ZONE_NAMES: Record<ZoneId, string> = {
  norte: 'Norte',
  nororiente: 'Nororiente',
  centro: 'Centro',
  oriente: 'Oriente / Aguablanca',
  ladera: 'Ladera occidente',
  sur: 'Sur',
  suroccidente: 'Suroccidente',
};
 
export class UpdateWorkerProfileDto {
  @IsOptional()
  @IsString()
  @MaxLength(1000, { message: 'La biografía no puede superar los 1000 caracteres' })
  bio?: string;
}
 
export class SetCoverageZonesDto {
  @IsArray({ message: 'Las zonas deben ser un arreglo' })
  @ArrayMinSize(1, { message: 'Debes seleccionar al menos una zona' })
  @IsIn(VALID_ZONE_IDS, { each: true, message: 'Una o más zonas no son válidas' })
  zone_ids: ZoneId[];
}

export class WorkerSkillInputDto {
  @IsUUID('4', { message: 'category_id debe ser un UUID válido' })
  category_id: string;

  @IsOptional()
  @Type(() => Number)
  @IsInt({ message: 'years_experience debe ser un número entero' })
  @Min(0, { message: 'years_experience no puede ser negativo' })
  years_experience?: number;

  @IsOptional()
  @Type(() => Number)
  @IsNumber({}, { message: 'base_price debe ser un número' })
  @Min(0, { message: 'base_price no puede ser negativo' })
  base_price?: number;
}

export class SetWorkerSkillsDto {
  @IsArray({ message: 'Las categorías deben ser un arreglo' })
  @ArrayMinSize(1, { message: 'Debes seleccionar al menos una categoría' })
  @ValidateNested({ each: true })
  @Type(() => WorkerSkillInputDto)
  skills: WorkerSkillInputDto[];
}