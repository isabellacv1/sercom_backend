import { Test, TestingModule } from '@nestjs/testing';
import { ProfilesService } from './profiles.service';
import { SupabaseService } from '../supabase/supabase.service';

describe('ProfilesService', () => {
  let instance: ProfilesService;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        ProfilesService,
        { provide: SupabaseService, useValue: {} }
      ],
    }).compile();

    instance = module.get<ProfilesService>(ProfilesService);
  });

  it('should be defined', () => {
    expect(instance).toBeDefined();
  });
});
