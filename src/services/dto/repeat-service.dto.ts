import { IsDateString, IsIn, IsInt, IsOptional } from 'class-validator';

export class RepeatServiceDto {
  /** Fecha deseada para el nuevo servicio (opcional). */
  @IsOptional()
  @IsDateString()
  scheduled_at?: string;
}

export const RECURRENCE_INTERVALS = [7, 15, 30] as const;

export class CreateRecurrenceDto {
  @IsInt()
  @IsIn(RECURRENCE_INTERVALS as unknown as number[], {
    message: 'La frecuencia debe ser cada 7, 15 o 30 días',
  })
  interval_days: number;
}
