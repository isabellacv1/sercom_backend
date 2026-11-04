import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  IsArray,
  IsBoolean,
  IsDateString,
  IsNotEmpty,
  IsNumber,
  IsOptional,
  IsString,
  IsUUID,
  Matches,
  MaxLength,
  ValidateNested,
} from 'class-validator';

const HHMM = /^([01]\d|2[0-3]):[0-5]\d$/;

/** Un horario en que el cliente puede recibir al profesional. */
export class AvailabilitySlotDto {
  @IsDateString()
  date: string;

  @Matches(HHMM, { message: 'from debe tener el formato HH:mm' })
  from: string;

  @Matches(HHMM, { message: 'to debe tener el formato HH:mm' })
  to: string;
}

export class CreateServiceDto {
  @IsUUID()
  category_id: string;

  @IsUUID()
  service_option_id: string;

  @IsString()
  @IsNotEmpty()
  @MaxLength(120)
  title: string;

  @IsString()
  @IsNotEmpty()
  @MaxLength(500)
  description: string;

  @IsString()
  @IsNotEmpty()
  address: string;

  @IsOptional()
  @IsString()
  city?: string;

  @IsOptional()
  @IsNumber()
  latitude?: number;

  @IsOptional()
  @IsNumber()
  longitude?: number;

  @IsOptional()
  @IsNumber()
  budget_min?: number;

  @IsOptional()
  @IsNumber()
  budget_max?: number;

  @IsOptional()
  @IsDateString()
  scheduled_at?: string;

  /** Servicio urgente (aplica recargo de tarifa dinámica). */
  @IsOptional()
  @IsBoolean()
  is_urgent?: boolean;

  /**
   * Profesional al que el cliente le pide el servicio directamente (desde
   * "Tus profesionales"). Tiene RESERVATION_HOURS de exclusividad.
   */
  @IsOptional()
  @IsUUID()
  preferred_worker_id?: string;

  /** Horarios del cliente (hasta 6). El profesional elige uno. */
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(6)
  @ValidateNested({ each: true })
  @Type(() => AvailabilitySlotDto)
  availability?: AvailabilitySlotDto[];
}
