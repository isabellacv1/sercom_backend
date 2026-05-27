import { Body, Controller, HttpCode, HttpStatus, Post } from '@nestjs/common';

import { ChatbotService } from './chatbot.service';
import { SendMessageDto } from './dto/send-message.dto';
import { ResolveDraftDto } from './dto/resolve-draft.dto';

@Controller('chatbot')
export class ChatbotController {
  constructor(private readonly chatbotService: ChatbotService) {}

  @Post('message')
  @HttpCode(HttpStatus.OK)
  async sendMessage(@Body() dto: SendMessageDto) {
    return this.chatbotService.processMessage(dto.messages);
  }

  @Post('resolve-draft')
  @HttpCode(HttpStatus.OK)
  async resolveDraft(@Body() dto: ResolveDraftDto) {
    return this.chatbotService.resolveDraft(dto);
  }
}
