import { IsUUID } from 'class-validator';

export class CompleteModuleDto {
  @IsUUID()
  module_id: string;
}
