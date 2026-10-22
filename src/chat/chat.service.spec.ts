import { Test, TestingModule } from '@nestjs/testing';
import { ChatService } from './chat.service';
import { SupabaseService } from '../supabase/supabase.service';

describe('ChatService', () => {
  let instance: ChatService;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        ChatService,
        { provide: SupabaseService, useValue: {} }
      ],
    }).compile();

    instance = module.get<ChatService>(ChatService);
  });

  it('should be defined', () => {
    expect(instance).toBeDefined();
  });
});
