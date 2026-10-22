import { Test, TestingModule } from '@nestjs/testing';
import { ServiceOptionsService } from './service-options.service';
import { SupabaseService } from '../supabase/supabase.service';

describe('ServiceOptionsService', () => {
  let instance: ServiceOptionsService;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        ServiceOptionsService,
        { provide: SupabaseService, useValue: {} }
      ],
    }).compile();

    instance = module.get<ServiceOptionsService>(ServiceOptionsService);
  });

  it('should be defined', () => {
    expect(instance).toBeDefined();
  });
});
