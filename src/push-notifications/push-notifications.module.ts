import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { SupabaseModule } from '../supabase/supabase.module';
import { PushNotificationsController } from './push-notifications.controller';
import { PushNotificationsService } from './push-notifications.service';

@Module({
  imports: [ConfigModule, SupabaseModule],
  controllers: [PushNotificationsController],
  providers: [PushNotificationsService],
  exports: [PushNotificationsService],
})
export class PushNotificationsModule {}
