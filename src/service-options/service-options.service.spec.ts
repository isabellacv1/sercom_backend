import { Test, TestingModule } from '@nestjs/testing';
import { ServiceOptionsService } from './service-options.service';

describe('ServiceOptionsService', () => {
  let service: ServiceOptionsService;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [ServiceOptionsService],
    }).compile();

    service = module.get<ServiceOptionsService>(ServiceOptionsService);
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });
});
