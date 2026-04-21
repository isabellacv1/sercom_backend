import { Module } from '@nestjs/common';
import { SupabaseModule } from '../supabase/supabase.module';
import { ServiceOptionsController } from './service-options.controller';
import { ServiceOptionsService } from './service-options.service';

@Module({
  imports: [SupabaseModule],
  controllers: [ServiceOptionsController],
  providers: [ServiceOptionsService],
  exports: [ServiceOptionsService],
})
export class ServiceOptionsModule {}