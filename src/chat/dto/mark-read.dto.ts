import { IsOptional, IsUUID } from 'class-validator';

export class MarkReadDto {
  /** Se ignora: se usa el usuario del token. */
  @IsOptional()
  @IsUUID()
  userId?: string;
}
