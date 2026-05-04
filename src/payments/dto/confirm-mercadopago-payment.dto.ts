import { IsIn, IsOptional, IsString } from 'class-validator';

export class ConfirmMercadoPagoPaymentDto {
  @IsIn(['approved', 'rejected'])
  result: 'approved' | 'rejected';

  @IsOptional()
  @IsString()
  provider_reference?: string;

  @IsOptional()
  @IsString()
  note?: string;
}