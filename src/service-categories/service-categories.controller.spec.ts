import { Test, TestingModule } from '@nestjs/testing';
import { ServiceCategoriesController } from './service-categories.controller';
import { ServiceCategoriesService } from './service-categories.service';

describe('ServiceCategoriesController', () => {
  let instance: ServiceCategoriesController;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      controllers: [ServiceCategoriesController],
      providers: [
        { provide: ServiceCategoriesService, useValue: {} }
      ],
    }).compile();

    instance = module.get<ServiceCategoriesController>(ServiceCategoriesController);
  });

  it('should be defined', () => {
    expect(instance).toBeDefined();
  });
});
