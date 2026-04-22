import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { SupabaseModule } from './supabase/supabase.module';
import { ProfilesModule } from './profiles/profiles.module';
import { AuthModule } from './auth/auth.module';
import { ServicesModule } from './services/services.module';
import { ServiceCategoriesModule } from './service-categories/service-categories.module';
import { ServiceOptionsService } from './service-options/service-options.service';
import { ServiceOptionsController } from './service-options/service-options.controller';
import { ServiceOptionsModule } from './service-options/service-options.module';
import { ServiceAssignmentsModule } from './service-assignments/service-assignments.module';
import { ProposalsModule } from './proposals/proposals.module';
import { ChatModule } from './chat/chat.module';

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
    ServiceOptionsModule,
    ProposalsModule,
    ServiceAssignmentsModule,
    ChatModule,
  ],
  providers: [ServiceOptionsService],
  controllers: [ServiceOptionsController],
})
export class AppModule {}
