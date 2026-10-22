import { Test, TestingModule } from '@nestjs/testing';
import { ServiceAssignmentsController } from './service-assignments.controller';
import { ServiceAssignmentsService } from './service-assignments.service';

describe('ServiceAssignmentsController', () => {
  let instance: ServiceAssignmentsController;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      controllers: [ServiceAssignmentsController],
      providers: [
        { provide: ServiceAssignmentsService, useValue: {} }
      ],
    }).compile();

    instance = module.get<ServiceAssignmentsController>(ServiceAssignmentsController);
  });

  it('should be defined', () => {
    expect(instance).toBeDefined();
  });
});
