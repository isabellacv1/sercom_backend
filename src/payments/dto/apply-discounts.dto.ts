import { IsBoolean, IsOptional, IsString, MaxLength } from 'class-validator';

export class ApplyDiscountsDto {
  /** Código de cupón; null o vacío lo quita. */
  @IsOptional()
  @IsString()
  @MaxLength(40)
  coupon_code?: string | null;

  /** Usar el saldo SERCOM disponible. */
  @IsOptional()
  @IsBoolean()
  use_credit?: boolean;
}
