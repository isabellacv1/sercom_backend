import { IsOptional, IsUUID } from 'class-validator';

export class CreateMercadoPagoLinkDto {
  @IsUUID()
  service_id: string;

  @IsOptional()
  payment_method?: 'mercadopago_link';
}
