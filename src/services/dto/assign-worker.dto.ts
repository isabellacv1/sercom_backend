import { IsUUID } from 'class-validator';

export class AssignWorkerDto {
  @IsUUID()
  worker_id: string;
}