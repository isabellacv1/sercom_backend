import { IsOptional, IsString, IsUUID } from 'class-validator';

export class CreateMessageDto {
  @IsUUID()
  roomId: string;

  @IsUUID()
  senderId: string;

  @IsOptional()
  @IsString()
  content?: string;

  @IsOptional()
  @IsString()
  attachmentUrl?: string;

}