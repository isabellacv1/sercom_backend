import { Module } from '@nestjs/common';
import { SupabaseModule } from '../supabase/supabase.module';
import { PushNotificationsModule } from '../push-notifications/push-notifications.module';
import { SupportController } from './support.controller';
import { SupportService } from './support.service';

@Module({
  imports: [SupabaseModule, PushNotificationsModule],
  controllers: [SupportController],
  providers: [SupportService],
})
export class SupportModule {}
