import { Test, TestingModule } from '@nestjs/testing';
import { ChatGateway } from './chat.gateway';
import { ChatService } from './chat.service';
import { SupabaseService } from '../supabase/supabase.service';

describe('ChatGateway', () => {
  let instance: ChatGateway;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        ChatGateway,
        { provide: ChatService, useValue: {} },
        { provide: SupabaseService, useValue: {} }
      ],
    }).compile();

    instance = module.get<ChatGateway>(ChatGateway);
  });

  it('should be defined', () => {
    expect(instance).toBeDefined();
  });
});
