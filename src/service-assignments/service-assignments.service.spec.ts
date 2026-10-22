import { Test, TestingModule } from '@nestjs/testing';
import { ServiceAssignmentsService } from './service-assignments.service';
import { SupabaseService } from '../supabase/supabase.service';

describe('ServiceAssignmentsService', () => {
  let instance: ServiceAssignmentsService;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        ServiceAssignmentsService,
        { provide: SupabaseService, useValue: {} }
      ],
    }).compile();

    instance = module.get<ServiceAssignmentsService>(ServiceAssignmentsService);
  });

  it('should be defined', () => {
    expect(instance).toBeDefined();
  });
});
