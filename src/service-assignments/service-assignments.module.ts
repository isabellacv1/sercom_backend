import { Module } from '@nestjs/common';
import { SupabaseModule } from '../supabase/supabase.module';
import { ServiceAssignmentsController } from './service-assignments.controller';
import { ServiceAssignmentsService } from './service-assignments.service';

@Module({
  imports: [SupabaseModule],
  controllers: [ServiceAssignmentsController],
  providers: [ServiceAssignmentsService],
  exports: [ServiceAssignmentsService],
})
export class ServiceAssignmentsModule {}
