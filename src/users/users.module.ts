import { Module } from '@nestjs/common';
import { UsersController } from './users.controller';
import { UsersService } from './users.service';
import { UsersDocumentsService } from './users-documents.service';
import { ProfilesService } from '../profiles/profiles.service';
import { SupabaseService } from '../supabase/supabase.service';

@Module({
  controllers: [UsersController],
  providers: [
    UsersService,
    UsersDocumentsService,
    ProfilesService,
    SupabaseService,
  ],
  exports: [UsersService],
})
export class UsersModule {}