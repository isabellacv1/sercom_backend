import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { SupabaseModule } from '../supabase/supabase.module';
import { MpOAuthController } from './mp-oauth.controller';
import { MpOAuthService } from './mp-oauth.service';

@Module({
  imports: [ConfigModule, SupabaseModule],
  controllers: [MpOAuthController],
  providers: [MpOAuthService],
  exports: [MpOAuthService],
})
export class MpOAuthModule {}
