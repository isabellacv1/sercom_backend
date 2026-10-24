import { IsIn, IsInt, IsNotEmpty, IsOptional, IsString, Max, MaxLength, Min } from 'class-validator';

export const MIN_GIFT = 20000;
export const MAX_GIFT = 500000;

export class BuyGiftCardDto {
  @IsInt({ message: 'El valor debe ser un número entero en pesos' })
  @Min(MIN_GIFT, { message: `El valor mínimo es $${MIN_GIFT.toLocaleString('es-CO')}` })
  @Max(MAX_GIFT, { message: `El valor máximo es $${MAX_GIFT.toLocaleString('es-CO')}` })
  amount: number;

  @IsOptional()
  @IsString()
  @MaxLength(60)
  recipient_name?: string;

  @IsOptional()
  @IsString()
  @MaxLength(240)
  message?: string;
}

export class RedeemGiftCardDto {
  @IsString()
  @IsNotEmpty({ message: 'Escribe el código de la tarjeta' })
  @MaxLength(20)
  code: string;
}

export class BuyBoostDto {
  @IsIn([7, 30], { message: 'El anuncio es por 7 o 30 días' })
  days: 7 | 30;
}
