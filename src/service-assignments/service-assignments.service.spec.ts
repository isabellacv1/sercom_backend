import { Test, TestingModule } from '@nestjs/testing';
import { ServiceAssignmentsService } from './service-assignments.service';

describe('ServiceAssignmentsService', () => {
  let service: ServiceAssignmentsService;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [ServiceAssignmentsService],
    }).compile();

    service = module.get<ServiceAssignmentsService>(ServiceAssignmentsService);
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });
});
