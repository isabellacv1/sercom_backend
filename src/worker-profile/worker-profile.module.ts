// src/worker-profile/worker-profile.module.ts
import { Module } from '@nestjs/common';
import { SupabaseModule } from '../supabase/supabase.module';
import { WorkerProfileController } from './worker-profile.controller';
import { WorkerProfileService } from './worker-profile.service';

@Module({
  imports: [SupabaseModule],
  controllers: [WorkerProfileController],
  providers: [WorkerProfileService],
  exports: [WorkerProfileService],
})
export class WorkerProfileModule {}
