import { IsBoolean, IsOptional, IsString, MaxLength } from 'class-validator';

export class RefundPaymentDto {
  @IsOptional()
  @IsString()
  @MaxLength(500)
  reason?: string;

  /**
   * Comprobante de la devolución hecha por fuera de Wompi (Nequi, PSE,
   * Bancolombia no se pueden anular por API; solo tarjetas).
   */
  @IsOptional()
  @IsString()
  @MaxLength(120)
  manual_reference?: string;

  /** Devolver como saldo SERCOM (inmediato) en vez de dinero. */
  @IsOptional()
  @IsBoolean()
  as_credit?: boolean;
}
