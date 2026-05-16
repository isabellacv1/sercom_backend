import { Injectable, InternalServerErrorException } from '@nestjs/common';

import { ConfigService } from '@nestjs/config';

import { GoogleGenerativeAI } from '@google/generative-ai';

import { ChatbotResponseDto } from '../dto/chatbot-response.dto';

import { CHATBOT_SYSTEM_PROMPT } from '../utils/chatbot-prompts';

@Injectable()
export class GeminiProvider {
  private genAI: GoogleGenerativeAI;

  constructor(private readonly configService: ConfigService) {
    this.genAI = new GoogleGenerativeAI(
      this.configService.get<string>('GEMINI_API_KEY')!,
    );
  }

  async generateResponse(messages: any[]): Promise<ChatbotResponseDto> {
    try {
      const model = this.genAI.getGenerativeModel({
        model: 'gemini-2.5-flash',
      });

      const conversation = messages
        .map((m) => {
          return `${m.isUser
              ? 'Usuario'
              : 'Asistente'
          }: ${m.text}`;

        })
        .join('\n');

      const prompt = `
  ${CHATBOT_SYSTEM_PROMPT}

  Conversación:
  ${conversation}
  `;

      const result = await model.generateContent(prompt);

      const rawResponse = result.response.text();

      const cleanedResponse = rawResponse
        .replace(/```json/g, '')
        .replace(/```/g, '')
        .trim();

      return JSON.parse(cleanedResponse);
    } catch (error) {
      console.error(error);

      throw new InternalServerErrorException('Error generando respuesta IA');
    }
  }
}
