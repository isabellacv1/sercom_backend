import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { SupabaseModule } from '../supabase/supabase.module';
import { PushNotificationsModule } from '../push-notifications/push-notifications.module';
import { PaymentsController, PaymentsWebhookController } from './payments.controller';
import { PaymentsService } from './payments.service';

@Module({
  imports: [ConfigModule, SupabaseModule, PushNotificationsModule],
  controllers: [PaymentsController, PaymentsWebhookController],
  providers: [PaymentsService],
  exports: [PaymentsService],
})
export class PaymentsModule {}
