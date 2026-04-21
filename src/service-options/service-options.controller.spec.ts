import { Test, TestingModule } from '@nestjs/testing';
import { ServiceOptionsController } from './service-options.controller';

describe('ServiceOptionsController', () => {
  let controller: ServiceOptionsController;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      controllers: [ServiceOptionsController],
    }).compile();

    controller = module.get<ServiceOptionsController>(ServiceOptionsController);
  });

  it('should be defined', () => {
    expect(controller).toBeDefined();
  });
});
