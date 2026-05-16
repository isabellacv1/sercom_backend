import { Injectable } from '@nestjs/common';

import { GeminiProvider } from './providers/gemini.provider';

@Injectable()
export class ChatbotService {
  constructor(private readonly geminiProvider: GeminiProvider) {}

  async processMessage(messages: any[]) {
    return await this.geminiProvider.generateResponse(messages);
  }
}
