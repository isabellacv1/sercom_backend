import { PushNotificationsService } from '../push-notifications/push-notifications.service';
import { Test, TestingModule } from '@nestjs/testing';
import { ServicesService } from './services.service';
import { SupabaseService } from '../supabase/supabase.service';
import { PaymentsService } from '../payments/payments.service';
import { ServiceEvidenceService } from './service-evidence.service';
import { LiveLocationService } from './live-location.service';
import { RepeatService } from './repeat.service';

describe('ServicesService', () => {
  let instance: ServicesService;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        ServicesService,
        { provide: SupabaseService, useValue: {} },
        { provide: PaymentsService, useValue: {} },
        { provide: ServiceEvidenceService, useValue: {} },
        { provide: LiveLocationService, useValue: {} },
        { provide: RepeatService, useValue: {} },
        { provide: PushNotificationsService, useValue: {} },
      ],
    }).compile();

    instance = module.get<ServicesService>(ServicesService);
  });

  it('should be defined', () => {
    expect(instance).toBeDefined();
  });
});
