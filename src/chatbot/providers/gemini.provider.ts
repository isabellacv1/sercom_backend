import { Injectable } from '@nestjs/common';

@Injectable()
export class GeminiProvider {
  async generateResponse(message: string): Promise<string> {
    return `Respuesta IA para: ${message}`;
  }
}
