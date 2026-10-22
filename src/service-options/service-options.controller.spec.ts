import { Test, TestingModule } from '@nestjs/testing';
import { ServiceOptionsController } from './service-options.controller';
import { ServiceOptionsService } from './service-options.service';

describe('ServiceOptionsController', () => {
  let instance: ServiceOptionsController;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      controllers: [ServiceOptionsController],
      providers: [
        { provide: ServiceOptionsService, useValue: {} }
      ],
    }).compile();

    instance = module.get<ServiceOptionsController>(ServiceOptionsController);
  });

  it('should be defined', () => {
    expect(instance).toBeDefined();
  });
});
