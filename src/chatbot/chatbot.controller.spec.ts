import { Test, TestingModule } from '@nestjs/testing';
import { ChatbotController } from './chatbot.controller';
import { ChatbotService } from './chatbot.service';

describe('ChatbotController', () => {
  let instance: ChatbotController;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      controllers: [ChatbotController],
      providers: [
        { provide: ChatbotService, useValue: {} }
      ],
    }).compile();

    instance = module.get<ChatbotController>(ChatbotController);
  });

  it('should be defined', () => {
    expect(instance).toBeDefined();
  });
});
