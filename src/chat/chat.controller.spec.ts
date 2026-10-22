import { Test, TestingModule } from '@nestjs/testing';
import { ChatController } from './chat.controller';
import { ChatService } from './chat.service';

describe('ChatController', () => {
  let instance: ChatController;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      controllers: [ChatController],
      providers: [
        { provide: ChatService, useValue: {} }
      ],
    }).compile();

    instance = module.get<ChatController>(ChatController);
  });

  it('should be defined', () => {
    expect(instance).toBeDefined();
  });
});
