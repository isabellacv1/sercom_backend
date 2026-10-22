import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { SupabaseModule } from '../supabase/supabase.module';
import { PushNotificationsModule } from '../push-notifications/push-notifications.module';
import { PaymentsController, PaymentsWebhookController } from './payments.controller';
import { PaymentsService } from './payments.service';
import { WompiService } from './wompi.service';
import { PayoutAccountService } from './payout-account.service';

@Module({
  imports: [ConfigModule, SupabaseModule, PushNotificationsModule],
  controllers: [PaymentsController, PaymentsWebhookController],
  providers: [PaymentsService, WompiService, PayoutAccountService],
  exports: [PaymentsService],
})
export class PaymentsModule {}
