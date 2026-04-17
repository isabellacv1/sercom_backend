import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { SupabaseModule } from './supabase/supabase.module';
import { ProfilesModule } from './profiles/profiles.module';
import { AuthModule } from './auth/auth.module';
import { ServicesModule } from './services/services.module';
import { ServiceCategoriesModule } from './service-categories/service-categories.module';

import { ProposalsModule } from './proposals/proposals.module';

import { ServiceAssignmentsModule } from './service-assignments/service-assignments.module';

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
    }),
    SupabaseModule,
    ProfilesModule,
    AuthModule,
    ServicesModule,
    ServiceCategoriesModule,
    ProposalsModule,
    ServiceAssignmentsModule,
  ],
})
export class AppModule {}
