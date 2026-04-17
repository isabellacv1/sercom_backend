import { Module } from '@nestjs/common';
import { AuthController } from './auth.controller';
import { AuthService } from './auth.service';
import { ProfilesModule } from '../profiles/profiles.module';
import { SupabaseModule } from '../supabase/supabase.module';

@Module({
  imports: [ProfilesModule, SupabaseModule],
  controllers: [AuthController],
  providers: [AuthService],
})
export class AuthModule {}