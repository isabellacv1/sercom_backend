import {
  Injectable,
  InternalServerErrorException,
  Logger,
  ServiceUnavailableException,
} from '@nestjs/common';

import { ConfigService } from '@nestjs/config';

import { GoogleGenerativeAI } from '@google/generative-ai';

import { ChatbotResponseDto, MissionDraftDto } from '../dto/chatbot-response.dto';

import { CHATBOT_ACTIONS, ChatbotAction } from '../utils/chatbot-prompts';

/** Solo se envían los últimos mensajes (contexto suficiente y menos costo). */
const MAX_HISTORY = 20;

// Reintentos para errores temporales (429 por minuto, 503 de sobrecarga)
const MAX_RETRIES = 2;

@Injectable()
export class GeminiProvider {
  private readonly logger = new Logger(GeminiProvider.name);
  private genAI: GoogleGenerativeAI;

  private readonly hasKey: boolean;

  /**
   * GEMINI_MODEL primero y luego modelos vigentes de respaldo: si Google
   * retira un modelo (respuesta 404), el asistente sigue funcionando.
   */
  private readonly models: string[];
  private modelIndex = 0;

  private get model() {
    return this.models[this.modelIndex];
  }

  constructor(private readonly configService: ConfigService) {
    const apiKey = this.configService.get<string>('GEMINI_API_KEY') ?? '';
    this.hasKey = apiKey.trim().length > 0;
    this.genAI = new GoogleGenerativeAI(apiKey);
    const configured = this.configService.get<string>('GEMINI_MODEL')?.trim();
    this.models = [
      ...new Set([configured, 'gemini-2.5-flash', 'gemini-2.5-flash-lite'].filter(
        (m): m is string => !!m,
      )),
    ];
    if (!this.hasKey) {
      this.logger.error('GEMINI_API_KEY no configurada: el asistente no podrá responder.');
    }
    this.logger.log(`Modelos Gemini: ${this.models.join(' → ')}`);
  }

  async generateResponse(systemPrompt: string, messages: any[]): Promise<ChatbotResponseDto> {
    const conversation = messages
      .slice(-MAX_HISTORY)
      .map((m) => `${m.isUser ? 'Usuario' : 'Asistente'}: ${String(m.text ?? '').slice(0, 1500)}`)
      .join('\n');

    const prompt = `${systemPrompt}\n\nConversación:\n${conversation}\n\nAsistente (JSON):`;

    if (!this.hasKey) {
      throw new ServiceUnavailableException(
        'El asistente no está configurado todavía (falta GEMINI_API_KEY en el servidor).',
      );
    }
    return this.callWithRetry(prompt, 0);
  }

  private async callWithRetry(
    prompt: string,
    attempt: number,
  ): Promise<ChatbotResponseDto> {
    try {
      // Modo JSON: Gemini devuelve directamente un objeto válido.
      const model = this.genAI.getGenerativeModel({
        model: this.model,
        generationConfig: { responseMimeType: 'application/json', temperature: 0.4 },
      });
      const result = await model.generateContent(prompt);
      const rawResponse = result.response.text();

      this.logger.debug(
        `[${this.model}] Respuesta recibida (${rawResponse.length} chars)`,
      );

      const parsed = this.extractAndParseJson(rawResponse);
      return this.buildSafeResponse(parsed);
    } catch (error: any) {
      // Modelo retirado o no disponible para esta llave: probar el siguiente.
      if (this.isModelNotFound(error) && this.modelIndex < this.models.length - 1) {
        this.logger.warn(
          `[${this.model}] no disponible (${error?.message ?? error}). Probando ${this.models[this.modelIndex + 1]}...`,
        );
        this.modelIndex++;
        return this.callWithRetry(prompt, 0);
      }

      if (this.isAuthError(error)) {
        this.logger.error(`[${this.model}] Llave de Gemini inválida: ${error?.message}`);
        throw new ServiceUnavailableException(
          'La llave del asistente no es válida. Revisa GEMINI_API_KEY en el servidor.',
        );
      }

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
        `[${this.model}] Error inesperado al generar respuesta (status ${error?.status ?? '?'}): ${error?.message ?? error}`,
      );
      throw new InternalServerErrorException(
        'Error generando respuesta del asistente.',
      );
    }
  }

  private isModelNotFound(error: any): boolean {
    const status = error?.status ?? error?.response?.status;
    const message: string = error?.message ?? '';
    return (
      status === 404 ||
      /not found|is not supported|no longer available|deprecated/i.test(message)
    );
  }

  private isAuthError(error: any): boolean {
    const status = error?.status ?? error?.response?.status;
    const message: string = error?.message ?? '';
    return status === 401 || status === 403 || /API key not valid|API_KEY_INVALID|permission/i.test(message);
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
      suggestions: [],
      action: null,
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

    const suggestions = Array.isArray(parsed.suggestions)
      ? parsed.suggestions
          .filter((x: unknown): x is string => typeof x === 'string' && x.trim().length > 0)
          .map((x: string) => x.trim().slice(0, 40))
          .slice(0, 3)
      : [];

    const action: ChatbotAction | null = CHATBOT_ACTIONS.includes(parsed.action)
      ? parsed.action
      : readyToCreate
        ? 'create_service'
        : null;

    return { reply, readyToCreate, missionDraft, suggestions, action };
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
