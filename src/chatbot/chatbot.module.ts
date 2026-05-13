import { Module } from '@nestjs/common';

import { ChatbotController } from './chatbot.controller';
import { ChatbotService } from './chatbot.service';
import { GeminiProvider } from './providers/gemini.provider';

@Module({
  controllers: [ChatbotController],
  providers: [ChatbotService, GeminiProvider],
})
export class ChatbotModule {}
