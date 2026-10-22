import { IsOptional, IsString, IsUUID } from 'class-validator';

export class CreateMessageDto {
  @IsUUID()
  roomId: string;

  /** Se ignora: el remitente es siempre el usuario del token. */
  @IsOptional()
  @IsUUID()
  senderId?: string;

  @IsOptional()
  @IsString()
  content?: string;

  @IsOptional()
  @IsString()
  attachmentUrl?: string;

}