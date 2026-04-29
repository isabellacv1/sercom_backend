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
            .select(`
            id,
            service_id,
            client_id,
            worker_id,
            created_at,
            service:services!chat_rooms_service_id_fkey (
                id,
                title,
                status
            ),
            client:profiles!chat_rooms_client_id_fkey (
                id,
                full_name,
                profile_image_url
            ),
            worker:profiles!chat_rooms_worker_id_fkey (
                id,
                full_name,
                profile_image_url
            )
            `)
            .eq('service_id', serviceId)
            .single();

        if (error || !data) {
            throw new NotFoundException('No se encontró la sala para este servicio');
        }

        return data;
        }

        async getMessagesByRoomId(roomId: string) {
        const { data, error } = await this.supabase
            .from('chat_messages')
            .select(`
            id,
            room_id,
            sender_id,
            content,
            created_at,
            is_read,
            message_type,
            attachment_url,
            sender:profiles!chat_messages_sender_id_fkey (
                id,
                full_name,
                profile_image_url
            )
            `)
            .eq('room_id', roomId)
            .order('created_at', { ascending: true });

        if (error) {
            throw new BadRequestException(error.message);
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
                .neq('sender_id', userId)
                .eq('is_read', false);

            if (error) {
                throw new BadRequestException('Error al marcar mensajes como leídos');
            }

            return { message: 'Mensajes leídos' };
            }


        async getUserRooms(
        userId: string,
        role: 'client' | 'worker' | 'all' = 'all',
        ) {
        let query = this.supabase
            .from('chat_rooms')
            .select(`
            id,
            service_id,
            client_id,
            worker_id,
            created_at,
            service:services!chat_rooms_service_id_fkey (
                id,
                title,
                status
            ),
            client:profiles!chat_rooms_client_id_fkey (
                id,
                full_name,
                profile_image_url
            ),
            worker:profiles!chat_rooms_worker_id_fkey (
                id,
                full_name,
                profile_image_url
            ),
            chat_messages (
                id,
                room_id,
                sender_id,
                content,
                created_at,
                is_read,
                message_type,
                attachment_url
            )
            `);

        if (role === 'client') {
            query = query.eq('client_id', userId);
        } else if (role === 'worker') {
            query = query.eq('worker_id', userId);
        } else {
            query = query.or(`client_id.eq.${userId},worker_id.eq.${userId}`);
        }

        const { data, error } = await query;

        if (error) {
            throw new BadRequestException(error.message);
        }

        const roomsWithInfo = (data ?? []).map((room: any) => {
            const messages = [...(room.chat_messages ?? [])].sort(
            (a, b) =>
                new Date(b.created_at).getTime() -
                new Date(a.created_at).getTime(),
            );

            const lastMessage = messages[0] ?? null;

            const unreadCount = messages.filter(
            (message) =>
                message.sender_id !== userId &&
                message.is_read === false,
            ).length;

            const participant =
            room.client_id === userId ? room.worker : room.client;

            return {
            ...room,
            participant,
            lastMessage,
            lastMessagePreview: lastMessage?.content ?? 'Sin mensajes todavía',
            updated_at: lastMessage?.created_at ?? room.created_at,
            unreadCount,
            };
        });

        roomsWithInfo.sort(
            (a, b) =>
            new Date(b.updated_at).getTime() -
            new Date(a.updated_at).getTime(),
        );

        return roomsWithInfo;
        }

          async getRoomById(roomId: string) {
        const { data, error } = await this.supabase
        .from('chat_rooms')
        .select(`
            id,
            service_id,
            client_id,
            worker_id,
            created_at,
            client:profiles!chat_rooms_client_id_fkey (
            id,
            full_name,
            profile_image_url
            ),
            worker:profiles!chat_rooms_worker_id_fkey (
            id,
            full_name,
            profile_image_url
            )
        `)
        .eq('id', roomId)
        .single();

        if (error || !data) {
        throw new NotFoundException('Sala no encontrada');
        }

        return data;
    
    }

}