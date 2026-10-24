import { IsInt, Max, Min } from 'class-validator';

export const MIN_TIP = 2000;
export const MAX_TIP = 200000;

export class CreateTipDto {
  @IsInt({ message: 'La propina debe ser un valor entero en pesos' })
  @Min(MIN_TIP, { message: `La propina mínima es de $${MIN_TIP.toLocaleString('es-CO')}` })
  @Max(MAX_TIP, { message: `La propina máxima es de $${MAX_TIP.toLocaleString('es-CO')}` })
  amount: number;
}
