import { Body, Controller, HttpCode, HttpStatus, Post, UseGuards } from '@nestjs/common';

import { ChatbotService } from './chatbot.service';
import { SendMessageDto } from './dto/send-message.dto';
import { ResolveDraftDto } from './dto/resolve-draft.dto';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import type { JwtUser } from '../auth/decorators/current-user.decorator';

// Requiere sesión: antes cualquiera en internet podía usarlo y gastar la
// cuota de Gemini.
@UseGuards(JwtAuthGuard)
@Controller('chatbot')
export class ChatbotController {
  constructor(private readonly chatbotService: ChatbotService) {}

  @Post('message')
  @HttpCode(HttpStatus.OK)
  async sendMessage(@CurrentUser() user: JwtUser, @Body() dto: SendMessageDto) {
    return this.chatbotService.processMessage(user.sub, dto.messages);
  }

  @Post('resolve-draft')
  @HttpCode(HttpStatus.OK)
  async resolveDraft(@Body() dto: ResolveDraftDto) {
    return this.chatbotService.resolveDraft(dto);
  }
}
