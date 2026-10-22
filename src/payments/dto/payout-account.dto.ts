import {
  IsIn,
  IsNotEmpty,
  IsOptional,
  IsString,
  Matches,
  MaxLength,
  ValidateIf,
} from 'class-validator';

export const PAYOUT_METHODS = ['nequi', 'daviplata', 'bank_account'] as const;
export type PayoutMethod = (typeof PAYOUT_METHODS)[number];

/** Dónde quiere recibir el profesional lo que gana. */
export class PayoutAccountDto {
  @IsIn(PAYOUT_METHODS)
  method: PayoutMethod;

  /** Celular para Nequi / Daviplata o número de cuenta bancaria. */
  @IsString()
  @Matches(/^\d{6,20}$/, {
    message: 'El número debe tener solo dígitos (entre 6 y 20)',
  })
  account_number: string;

  @ValidateIf((o: PayoutAccountDto) => o.method === 'bank_account')
  @IsString()
  @IsNotEmpty({ message: 'Indica el banco' })
  @MaxLength(60)
  bank_name?: string;

  @ValidateIf((o: PayoutAccountDto) => o.method === 'bank_account')
  @IsIn(['ahorros', 'corriente'], {
    message: 'El tipo de cuenta debe ser ahorros o corriente',
  })
  account_type?: 'ahorros' | 'corriente';

  @IsString()
  @IsNotEmpty({ message: 'Indica el nombre del titular' })
  @MaxLength(120)
  holder_name: string;

  @IsOptional()
  @IsString()
  @Matches(/^\d{5,15}$/, { message: 'La cédula debe tener solo dígitos' })
  holder_document?: string;
}
