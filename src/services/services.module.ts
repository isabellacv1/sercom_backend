import { Module } from '@nestjs/common';
import { ServicesController } from './services.controller';
import { ServicesService } from './services.service';
import { ServiceEvidenceService } from './service-evidence.service';
import { LiveLocationService } from './live-location.service';
import { RepeatService } from './repeat.service';
import { PushNotificationsModule } from '../push-notifications/push-notifications.module';
import { MissionsController } from './missions.controller';
import { PaymentsModule } from '../payments/payments.module';

@Module({
  imports: [PaymentsModule, PushNotificationsModule],
  controllers: [ServicesController, MissionsController],
  providers: [ServicesService, ServiceEvidenceService, LiveLocationService, RepeatService],
})
export class ServicesModule {}
