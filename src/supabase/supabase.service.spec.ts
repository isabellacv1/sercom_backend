import { Test, TestingModule } from '@nestjs/testing';
import { SupabaseService } from './supabase.service';
import { ConfigService } from '@nestjs/config';

describe('SupabaseService', () => {
  let instance: SupabaseService;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        SupabaseService,
        {
          provide: ConfigService,
          useValue: { get: (k: string) => ({ SUPABASE_URL: 'http://localhost', SUPABASE_SECRET_KEY: 'test', SUPABASE_ANON_KEY: 'anon' } as Record<string, string>)[k] },
        },
      ],
    }).compile();

    instance = module.get<SupabaseService>(SupabaseService);
  });

  it('should be defined', () => {
    expect(instance).toBeDefined();
  });
});
