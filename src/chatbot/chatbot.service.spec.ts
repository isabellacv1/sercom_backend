import { Test, TestingModule } from '@nestjs/testing';
import { ChatbotService } from './chatbot.service';
import { GeminiProvider } from './providers/gemini.provider';
import { SupabaseService } from '../supabase/supabase.service';

describe('ChatbotService', () => {
  let instance: ChatbotService;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        ChatbotService,
        { provide: GeminiProvider, useValue: {} },
        { provide: SupabaseService, useValue: {} }
      ],
    }).compile();

    instance = module.get<ChatbotService>(ChatbotService);
  });

  it('should be defined', () => {
    expect(instance).toBeDefined();
  });
});
