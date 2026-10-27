import { IsBoolean } from 'class-validator';

export class SetWarrantyDto {
  @IsBoolean()
  enabled: boolean;
}
