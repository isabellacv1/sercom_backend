export interface ChatbotResponse {
  reply: string;

  readyToCreate: boolean;

  missionDraft?: {
    title?: string;
    description?: string;
    category?: string;
    urgent?: boolean;
    location?: string;
  };
}
