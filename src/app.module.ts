import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { SupabaseModule } from './supabase/supabase.module';
import { ProfilesModule } from './profiles/profiles.module';
import { AuthModule } from './auth/auth.module';
import { ServicesModule } from './services/services.module';
import { ServiceCategoriesModule } from './service-categories/service-categories.module';

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
  ],
})
export class AppModule {}
