import { IsOptional, IsString } from 'class-validator';

export class FindCandidateWorkersDto {
  @IsOptional()
  @IsString()
  city?: string;
}