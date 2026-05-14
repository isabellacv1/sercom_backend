import { Injectable, ServiceUnavailableException } from '@nestjs/common';

import { ConfigService } from '@nestjs/config';

import { GoogleGenerativeAI } from '@google/generative-ai';

import { CHATBOT_SYSTEM_PROMPT } from '../utils/chatbot-prompts';

@Injectable()
export class GeminiProvider {
  private readonly genAI: GoogleGenerativeAI;

  constructor(private readonly configService: ConfigService) {
    const apiKey = this.configService.get<string>('GEMINI_API_KEY');

    if (!apiKey) {
      throw new Error('GEMINI_API_KEY no está definida');
    }

    this.genAI = new GoogleGenerativeAI(apiKey);
  }

  async generateResponse(message: string): Promise<string> {
    try {
      const model = this.genAI.getGenerativeModel({
        model: 'gemini-2.5-flash',
      });

      const prompt = `
${CHATBOT_SYSTEM_PROMPT}

Usuario:
${message}
`;

      const result = await model.generateContent(prompt);

      return result.response.text();
    } catch (error) {
      console.error(error);

      throw new ServiceUnavailableException(
        'La IA no está disponible actualmente',
      );
    }
  }
}
