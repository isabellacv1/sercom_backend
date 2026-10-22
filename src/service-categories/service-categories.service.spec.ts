import { Test, TestingModule } from '@nestjs/testing';
import { ServiceCategoriesService } from './service-categories.service';
import { SupabaseService } from '../supabase/supabase.service';

describe('ServiceCategoriesService', () => {
  let instance: ServiceCategoriesService;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        ServiceCategoriesService,
        { provide: SupabaseService, useValue: {} }
      ],
    }).compile();

    instance = module.get<ServiceCategoriesService>(ServiceCategoriesService);
  });

  it('should be defined', () => {
    expect(instance).toBeDefined();
  });
});
