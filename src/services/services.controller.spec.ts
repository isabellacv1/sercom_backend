import { Test, TestingModule } from '@nestjs/testing';
import { ServicesController } from './services.controller';
import { ServicesService } from './services.service';
import { ServiceEvidenceService } from './service-evidence.service';

describe('ServicesController', () => {
  let instance: ServicesController;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      controllers: [ServicesController],
      providers: [
        { provide: ServicesService, useValue: {} },
        { provide: ServiceEvidenceService, useValue: {} },
      ],
    }).compile();

    instance = module.get<ServicesController>(ServicesController);
  });

  it('should be defined', () => {
    expect(instance).toBeDefined();
  });
});
