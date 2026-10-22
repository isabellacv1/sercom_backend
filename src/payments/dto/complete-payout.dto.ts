import { IsIn, IsNotEmpty, IsOptional, IsString, MaxLength } from 'class-validator';

export class CompletePayoutDto {
  /** Comprobante de la transferencia (número de Nequi, banco, etc.). */
  @IsString()
  @IsNotEmpty()
  @MaxLength(120)
  reference: string;

  @IsOptional()
  @IsIn(['nequi', 'bancolombia', 'bank_transfer', 'daviplata', 'other'])
  method?: string;

  @IsOptional()
  @IsString()
  @MaxLength(500)
  note?: string;
}
