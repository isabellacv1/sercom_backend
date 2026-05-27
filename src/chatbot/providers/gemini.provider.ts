import {
  Injectable,
  InternalServerErrorException,
  Logger,
  ServiceUnavailableException,
} from '@nestjs/common';

import { ConfigService } from '@nestjs/config';

import { GoogleGenerativeAI } from '@google/generative-ai';

import { ChatbotResponseDto, MissionDraftDto } from '../dto/chatbot-response.dto';

import { CHATBOT_SYSTEM_PROMPT } from '../utils/chatbot-prompts';

// Reintentos para errores temporales (429 por minuto, 503 de sobrecarga)
const MAX_RETRIES = 2;

@Injectable()
export class GeminiProvider {
  private readonly logger = new Logger(GeminiProvider.name);
  private genAI: GoogleGenerativeAI;

  private readonly model: string;

  constructor(private readonly configService: ConfigService) {
    this.genAI = new GoogleGenerativeAI(
      this.configService.get<string>('GEMINI_API_KEY')!,
    );
    // Configurable via GEMINI_MODEL en .env — default: gemini-2.0-flash
    this.model =
      this.configService.get<string>('GEMINI_MODEL') ?? 'gemini-2.0-flash';
    this.logger.log(`Modelo Gemini configurado: ${this.model}`);
  }

  async generateResponse(messages: any[]): Promise<ChatbotResponseDto> {
    const conversation = messages
      .map((m) => `${m.isUser ? 'Usuario' : 'Asistente'}: ${m.text}`)
      .join('\n');

    const prompt = `${CHATBOT_SYSTEM_PROMPT}\n\nConversación:\n${conversation}`;

    return this.callWithRetry(prompt, 0);
  }

  private async callWithRetry(
    prompt: string,
    attempt: number,
  ): Promise<ChatbotResponseDto> {
    try {
      const model = this.genAI.getGenerativeModel({ model: this.model });
      const result = await model.generateContent(prompt);
      const rawResponse = result.response.text();

      this.logger.debug(
        `[${this.model}] Respuesta recibida (${rawResponse.length} chars)`,
      );

      const parsed = this.extractAndParseJson(rawResponse);
      return this.buildSafeResponse(parsed);
    } catch (error: any) {
      const is429 = this.isQuotaError(error);
      const is503 = this.isOverloadError(error);

      // 503 de sobrecarga temporal o 429 de rate limit por minuto → reintentar
      if ((is503 || is429) && !this.isDailyQuotaError(error) && attempt < MAX_RETRIES) {
        const delayMs = this.extractRetryDelay(error) ?? (attempt + 1) * 3000;
        this.logger.warn(
          `[${this.model}] Error temporal (${is503 ? '503' : '429'}). Reintento ${attempt + 1}/${MAX_RETRIES} en ${delayMs}ms...`,
        );
        await this.sleep(delayMs);
        return this.callWithRetry(prompt, attempt + 1);
      }

      if (is429 && this.isDailyQuotaError(error)) {
        const msg = 'Cuota diaria del asistente agotada. La cuota se renueva a medianoche (UTC). Puedes activar facturación en Google AI Studio para obtener más cuota.';
        this.logger.error(`[${this.model}] ${msg}`);
        throw new ServiceUnavailableException(msg);
      }

      if (is503) {
        const msg = 'El asistente está experimentando alta demanda. Por favor intenta de nuevo en unos segundos.';
        this.logger.error(`[${this.model}] ${msg}`);
        throw new ServiceUnavailableException(msg);
      }

      this.logger.error(
        `[${this.model}] Error inesperado al generar respuesta`,
        error?.message ?? error,
      );
      throw new InternalServerErrorException(
        'Error generando respuesta del asistente.',
      );
    }
  }

  private isOverloadError(error: any): boolean {
    if (!error) return false;
    const status = error?.status ?? error?.response?.status;
    if (status === 503) return true;
    const message: string = error?.message ?? '';
    return message.includes('503') || message.includes('high demand') || message.includes('Service Unavailable');
  }

  private isQuotaError(error: any): boolean {
    if (!error) return false;
    const status = error?.status ?? error?.response?.status;
    if (status === 429) return true;
    const message: string = error?.message ?? '';
    return message.includes('429') || message.includes('Too Many Requests') || message.includes('quota');
  }

  private isDailyQuotaError(error: any): boolean {
    try {
      const details: any[] = error?.errorDetails ?? [];
      return details.some(
        (d) =>
          d?.quotaId?.includes('PerDay') ||
          d?.violations?.some((v: any) => v?.quotaId?.includes('PerDay')),
      );
    } catch (_) {
      return false;
    }
  }

  private extractRetryDelay(error: any): number | null {
    try {
      const details: any[] = error?.errorDetails ?? [];
      for (const detail of details) {
        if (detail?.retryDelay) {
          const seconds = parseFloat(detail.retryDelay.replace('s', ''));
          if (!isNaN(seconds)) return Math.ceil(seconds) * 1000;
        }
      }
    } catch (_) {}
    return null;
  }

  private sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  private extractAndParseJson(rawText: string): Record<string, any> {
    const cleaned = rawText
      .replace(/```json\s*/gi, '')
      .replace(/```\s*/g, '')
      .trim();

    try {
      return JSON.parse(cleaned);
    } catch (_) {
      const jsonMatch = cleaned.match(/\{[\s\S]*\}/);
      if (jsonMatch) {
        try {
          return JSON.parse(jsonMatch[0]);
        } catch (_) {
          this.logger.warn(
            `No se pudo extraer JSON válido: ${cleaned.slice(0, 200)}`,
          );
        }
      }
    }

    return {
      reply: 'Disculpa, tuve un problema procesando tu mensaje. ¿Puedes repetirlo?',
      readyToCreate: false,
      missionDraft: null,
    };
  }

  private buildSafeResponse(parsed: Record<string, any>): ChatbotResponseDto {
    const reply =
      typeof parsed.reply === 'string' && parsed.reply.trim().length > 0
        ? parsed.reply.trim()
        : 'Cuéntame más sobre el servicio que necesitas.';

    const readyToCreate =
      parsed.readyToCreate === true &&
      parsed.missionDraft != null &&
      typeof parsed.missionDraft === 'object';

    const missionDraft = readyToCreate
      ? this.buildSafeDraft(parsed.missionDraft)
      : null;

    return { reply, readyToCreate, missionDraft } as ChatbotResponseDto;
  }

  private buildSafeDraft(raw: Record<string, any>): MissionDraftDto {
    return {
      category: typeof raw.category === 'string' ? raw.category.trim() : '',
      serviceType:
        typeof raw.serviceType === 'string' ? raw.serviceType.trim() : '',
      description:
        typeof raw.description === 'string' ? raw.description.trim() : '',
      location: typeof raw.location === 'string' ? raw.location.trim() : '',
      urgent: raw.urgent === true,
    };
  }
}
