import { Injectable, NotFoundException, BadRequestException } from '@nestjs/common';
import { SupabaseService } from '../supabase/supabase.service';
import { CreateMessageDto } from './dto/create-message.dto';

@Injectable()
export class ChatService {
  constructor(private readonly supabaseService: SupabaseService) {}

  private get supabase() {
    return this.supabaseService.sb;
    }

  async getRoomByServiceId(serviceId: string) {
    const { data, error } = await this.supabase
      .from('chat_rooms')
      .select('*')
      .eq('service_id', serviceId)
      .single();

    if (error) {
      throw new NotFoundException('No se encontró la sala para este servicio');
    }

    return data;
  }

  async getMessagesByRoomId(roomId: string) {
    const { data, error } = await this.supabase
      .from('chat_messages')
      .select('*')
      .eq('room_id', roomId)
      .order('created_at', { ascending: true });

    if (error) {
      throw new BadRequestException('Error al obtener los mensajes');
    }

    return data;
  }

  async sendMessage(dto: CreateMessageDto) {
    if (!dto.content && !dto.attachmentUrl) {
        throw new BadRequestException('El mensaje debe tener contenido o archivo');
    }

    
    const { data: room, error: roomError } = await this.supabase
        .from('chat_rooms')
        .select('*')
        .eq('id', dto.roomId)
        .single();

    if (roomError || !room) {
        throw new NotFoundException('Sala no encontrada');
    }

    
    if (
        dto.senderId !== room.client_id &&
        dto.senderId !== room.worker_id
    ) {
        throw new BadRequestException('No perteneces a esta conversación');
    }

    const payload = {
        room_id: dto.roomId,
        sender_id: dto.senderId,
        content: dto.content ?? null,
        attachment_url: dto.attachmentUrl ?? null,
        is_read: false,
        message_type: 'text' as const,
    };

    const { data, error } = await this.supabase
        .from('chat_messages')
        .insert(payload)
        .select()
        .single();

    if (error) {
        throw new BadRequestException('Error al enviar el mensaje');
    }

    return data;
    }

  async markMessagesAsRead(roomId: string, userId: string) {
    const { error } = await this.supabase
        .from('chat_messages')
        .update({ is_read: true })
        .eq('room_id', roomId)
        .neq('sender_id', userId);

    if (error) {
        throw new BadRequestException('Error al marcar mensajes como leídos');
    }

    return { message: 'Mensajes leídos' };
    }


  async getUserRooms(userId: string) {
    const { data, error } = await this.supabase
        .from('chat_rooms')
        .select(`
        *,
        chat_messages (
            content,
            created_at
        )
        `)
        .or(`client_id.eq.${userId},worker_id.eq.${userId}`);

    if (error) {
        throw new BadRequestException('Error al obtener conversaciones');
    }

    
    const roomsWithLastMessage = data.map((room) => {
        const lastMessage = room.chat_messages?.sort(
        (a, b) =>
            new Date(b.created_at).getTime() -
            new Date(a.created_at).getTime(),
        )[0];

        return {
        ...room,
        lastMessage,
        };
    });

    return roomsWithLastMessage;
    }


    async getRoomById(roomId: string) {
        const { data, error } = await this.supabase
            .from('chat_rooms')
            .select('*')
            .eq('id', roomId)
            .single();

        if (error || !data) {
            throw new NotFoundException('Sala no encontrada');
        }

        return data;
    }

}