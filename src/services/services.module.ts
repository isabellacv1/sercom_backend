import { Module } from '@nestjs/common';
import { ServicesController } from './services.controller';
import { ServicesService } from './services.service';
import { ServiceEvidenceService } from './service-evidence.service';
import { LiveLocationService } from './live-location.service';
import { MissionsController } from './missions.controller';
import { PaymentsModule } from '../payments/payments.module';

@Module({
  imports: [PaymentsModule],
  controllers: [ServicesController, MissionsController],
  providers: [ServicesService, ServiceEvidenceService, LiveLocationService],
})
export class ServicesModule {}
