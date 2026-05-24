import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { SupabaseModule } from '../supabase/supabase.module';
import { PushNotificationsModule } from '../push-notifications/push-notifications.module';
import { PaymentsController, PaymentsWebhookController } from './payments.controller';
import { PaymentsService } from './payments.service';
import { PayoutService } from './payout.service';
import { MpOAuthModule } from '../oauth/mp-oauth.module';

@Module({
  imports: [ConfigModule, SupabaseModule, PushNotificationsModule, MpOAuthModule],
  controllers: [PaymentsController, PaymentsWebhookController],
  providers: [PaymentsService, PayoutService],
  exports: [PaymentsService],
})
export class PaymentsModule {}
