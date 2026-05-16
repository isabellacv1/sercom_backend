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

  missionDraft: MissionDraftDto;
}
