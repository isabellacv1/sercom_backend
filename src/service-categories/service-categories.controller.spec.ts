import { Test, TestingModule } from '@nestjs/testing';
import { ServiceCategoriesController } from './service-categories.controller';

describe('ServiceCategoriesController', () => {
  let controller: ServiceCategoriesController;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      controllers: [ServiceCategoriesController],
    }).compile();

    controller = module.get<ServiceCategoriesController>(ServiceCategoriesController);
  });

  it('should be defined', () => {
    expect(controller).toBeDefined();
  });
});
