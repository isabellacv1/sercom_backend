import { IsString, IsNotEmpty } from 'class-validator';

export class ResolveDraftDto {
  @IsString()
  @IsNotEmpty()
  category: string;

  @IsString()
  @IsNotEmpty()
  serviceType: string;
}
