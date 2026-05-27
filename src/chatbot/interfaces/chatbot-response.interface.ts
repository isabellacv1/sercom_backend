export interface ChatbotResponse {
  reply: string;
  readyToCreate: boolean;
  missionDraft: {
    category: string;
    serviceType: string;
    description: string;
    location: string;
    urgent: boolean;
  } | null;
}
