import { IsIn } from 'class-validator';

export class UpdateServiceStatusDto {
  @IsIn(['on_the_way', 'in_progress', 'completed'])
  status: 'on_the_way' | 'in_progress' | 'completed';
}