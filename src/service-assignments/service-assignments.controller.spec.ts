import { Test, TestingModule } from '@nestjs/testing';
import { ServiceAssignmentsController } from './service-assignments.controller';

describe('ServiceAssignmentsController', () => {
  let controller: ServiceAssignmentsController;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      controllers: [ServiceAssignmentsController],
    }).compile();

    controller = module.get<ServiceAssignmentsController>(ServiceAssignmentsController);
  });

  it('should be defined', () => {
    expect(controller).toBeDefined();
  });
});
