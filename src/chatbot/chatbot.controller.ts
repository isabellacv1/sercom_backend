import {
  Body,
  Controller,
  HttpCode,
  HttpStatus,
  Post,
  UploadedFile,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { memoryStorage } from 'multer';
import type { MulterFile } from '../common/types/multer.types';

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

  // Cotización con foto: { photo: archivo, note?: texto }
  @Post('photo-quote')
  @HttpCode(HttpStatus.OK)
  @UseInterceptors(FileInterceptor('photo', { storage: memoryStorage(), limits: { fileSize: 6 * 1024 * 1024 } }))
  async photoQuote(
    @CurrentUser() user: JwtUser,
    @UploadedFile() file: MulterFile,
    @Body('note') note?: string,
  ) {
    return this.chatbotService.photoQuote(user.sub, file, typeof note === 'string' ? note : undefined);
  }

  @Post('resolve-draft')
  @HttpCode(HttpStatus.OK)
  async resolveDraft(@Body() dto: ResolveDraftDto) {
    return this.chatbotService.resolveDraft(dto);
  }
}
