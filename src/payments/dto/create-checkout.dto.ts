import { IsUUID } from 'class-validator';

export class CreateCheckoutDto {
  @IsUUID()
  service_id: string;
}
