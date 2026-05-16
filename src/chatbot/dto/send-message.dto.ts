import {
  IsArray,
  IsBoolean,
  IsString,
} from 'class-validator';

export class ChatMessageDto {

  @IsString()
  text: string;

  @IsBoolean()
  isUser: boolean;
}

export class SendMessageDto {

  @IsArray()
  messages: ChatMessageDto[];
}
