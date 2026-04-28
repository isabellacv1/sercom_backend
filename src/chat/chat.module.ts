import { Module } from '@nestjs/common';
import { ChatController } from './chat.controller';
import { ChatService } from './chat.service';
import { ChatGateway } from './chat.gateway';
import { SupabaseService } from '../supabase/supabase.service';

@Module({
  controllers: [ChatController],
  providers: [ChatService, ChatGateway, SupabaseService],
})


export class ChatModule {}
