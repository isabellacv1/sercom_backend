import type { ChatbotAction } from '../utils/chatbot-prompts';

export class MissionDraftDto {
  category: string;
  serviceType: string;
  description: string;
  location: string;
  urgent: boolean;
}

export class ChatbotResponseDto {
  reply: string;
  readyToCreate: boolean;
  missionDraft: MissionDraftDto | null;
  /** Respuestas rápidas que la app muestra como botones. */
  suggestions: string[];
  /** Acción que la app ofrece como botón (abrir reporte, Plus, WhatsApp...). */
  action: ChatbotAction | null;
}
