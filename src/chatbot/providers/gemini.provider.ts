import { Injectable, ServiceUnavailableException } from '@nestjs/common';

import { ConfigService } from '@nestjs/config';

import { GoogleGenerativeAI } from '@google/generative-ai';

import { CHATBOT_SYSTEM_PROMPT } from '../utils/chatbot-prompts';

import { cleanChatbotResponse } from '../utils/chatbot-formatter';

@Injectable()
export class GeminiProvider {
  private readonly genAI: GoogleGenerativeAI;

  // memoria temporal simple
  private conversationHistory: string[] = [];

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

      // guardar mensaje usuario
      this.conversationHistory.push(`Usuario: ${message}`);

      // limitar historial
      if (this.conversationHistory.length > 6) {
        this.conversationHistory.shift();
      }

      const prompt = `
${CHATBOT_SYSTEM_PROMPT}

Historial conversación:
${this.conversationHistory.join('\n')}
`;

      const result = await model.generateContent(prompt);

      const rawResponse = result.response.text();

      const cleanedResponse = cleanChatbotResponse(rawResponse);

      // guardar respuesta IA
      this.conversationHistory.push(`Asistente: ${cleanedResponse}`);

      return cleanedResponse;
    } catch (error) {
      console.error(error);

      throw new ServiceUnavailableException(
        'La IA no está disponible actualmente',
      );
    }
  }
}
