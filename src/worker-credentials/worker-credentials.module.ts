import { Module } from '@nestjs/common';
import { SupabaseModule } from '../supabase/supabase.module';
import { WorkerCredentialsController } from './worker-credentials.controller';
import { WorkerCredentialsService } from './worker-credentials.service';

@Module({
  imports: [SupabaseModule],
  controllers: [WorkerCredentialsController],
  providers: [WorkerCredentialsService],
})
export class WorkerCredentialsModule {}
