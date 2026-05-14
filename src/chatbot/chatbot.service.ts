import { Injectable, InternalServerErrorException } from '@nestjs/common';

import { GeminiProvider } from './providers/gemini.provider';

@Injectable()
export class ChatbotService {
  constructor(private readonly geminiProvider: GeminiProvider) {}

  async processMessage(message: string) {
    try {
      const response = await this.geminiProvider.generateResponse(message);

      return {
        reply: response,
      };
    } catch (error) {
      throw new InternalServerErrorException(
        'Error procesando mensaje ' + error,
      );
    }
  }
}
