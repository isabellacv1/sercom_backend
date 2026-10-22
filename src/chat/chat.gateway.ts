import {
  ConnectedSocket,
  MessageBody,
  OnGatewayConnection,
  SubscribeMessage,
  WebSocketGateway,
  WebSocketServer,
} from '@nestjs/websockets';
import { Server, Socket } from 'socket.io';
import { ChatService } from './chat.service';
import { SupabaseService } from '../supabase/supabase.service';

/**
 * Chat en tiempo real.
 *
 * Seguridad: la validación del token es asíncrona y socket.io empieza a
 * procesar eventos antes de que termine `handleConnection`. Por eso cada
 * evento ESPERA `client.data.auth` y la identidad sale solo del token; los
 * `userId`/`senderId` que envía el cliente se ignoran (antes se usaban como
 * respaldo y permitían suplantar a otro usuario en esa ventana).
 */
@WebSocketGateway({
  cors: {
    origin: process.env.MP_FRONTEND_URL ?? '*',
    credentials: true,
  },
})
export class ChatGateway implements OnGatewayConnection {
  @WebSocketServer()
  server: Server;

  constructor(
    private readonly chatService: ChatService,
    private readonly supabaseService: SupabaseService,
  ) {}

  handleConnection(client: Socket) {
    client.data.auth = this.authenticate(client);
  }

  private async authenticate(client: Socket): Promise<string | null> {
    const token =
      (client.handshake.auth?.token as string | undefined) ??
      (client.handshake.headers?.authorization as string | undefined)?.replace(
        'Bearer ',
        '',
      );

    if (!token) {
      client.disconnect();
      return null;
    }

    const { data, error } =
      await this.supabaseService.client.auth.getUser(token);

    if (error || !data.user) {
      client.disconnect();
      return null;
    }

    client.data.userId = data.user.id;
    return data.user.id;
  }

  /** Usuario autenticado del socket (espera la validación del token). */
  private async userOf(client: Socket): Promise<string | null> {
    return ((await client.data.auth) as string | null) ?? null;
  }

  private async isRoomMember(roomId: string, userId: string) {
    try {
      const room = await this.chatService.getRoomById(roomId);
      return room.client_id === userId || room.worker_id === userId;
    } catch {
      return false;
    }
  }

  private async serviceRole(serviceId: string, userId: string) {
    const { data } = await this.supabaseService.client
      .from('services')
      .select('client_id, assigned_worker_id')
      .eq('id', serviceId)
      .maybeSingle();
    if (!data) return null;
    if (data.assigned_worker_id === userId) return 'worker';
    if (data.client_id === userId) return 'client';
    return null;
  }

  @SubscribeMessage('joinRoom')
  async handleJoinRoom(
    @MessageBody() data: { roomId: string },
    @ConnectedSocket() client: Socket,
  ) {
    const userId = await this.userOf(client);
    if (!userId || !(await this.isRoomMember(data.roomId, userId))) {
      return { error: 'No autorizado' };
    }

    await client.join(data.roomId);
    return { message: `Unido a la sala ${data.roomId}` };
  }

  @SubscribeMessage('leaveRoom')
  async handleLeaveRoom(
    @MessageBody() data: { roomId: string },
    @ConnectedSocket() client: Socket,
  ) {
    await client.leave(data.roomId);
    return { message: `Saliste de la sala ${data.roomId}` };
  }

  @SubscribeMessage('sendMessage')
  async handleSendMessage(
    @MessageBody()
    data: { roomId: string; content?: string; attachmentUrl?: string },
    @ConnectedSocket() client: Socket,
  ) {
    const senderId = await this.userOf(client);
    if (!senderId) return { error: 'No autorizado' };

    // ChatService.sendMessage valida que el remitente pertenezca a la sala.
    const message = await this.chatService.sendMessage({
      roomId: data.roomId,
      content: data.content,
      attachmentUrl: data.attachmentUrl,
      senderId,
    });

    this.server.to(data.roomId).emit('newMessage', message);
    return message;
  }

  @SubscribeMessage('markAsRead')
  async handleMarkAsRead(
    @MessageBody() data: { roomId: string },
    @ConnectedSocket() client: Socket,
  ) {
    const userId = await this.userOf(client);
    if (!userId || !(await this.isRoomMember(data.roomId, userId))) {
      return { error: 'No autorizado' };
    }

    await this.chatService.markMessagesAsRead(data.roomId, userId);
    this.server.to(data.roomId).emit('messagesRead', {
      roomId: data.roomId,
      userId,
    });
    return { ok: true };
  }

  @SubscribeMessage('typing')
  async handleTyping(
    @MessageBody() data: { roomId: string },
    @ConnectedSocket() client: Socket,
  ) {
    const userId = await this.userOf(client);
    if (!userId || !client.rooms.has(data.roomId)) return;
    client.to(data.roomId).emit('peerTyping', { roomId: data.roomId, userId });
  }

  @SubscribeMessage('stopTyping')
  async handleStopTyping(
    @MessageBody() data: { roomId: string },
    @ConnectedSocket() client: Socket,
  ) {
    const userId = await this.userOf(client);
    if (!userId || !client.rooms.has(data.roomId)) return;
    client.to(data.roomId).emit('peerStopTyping', { roomId: data.roomId, userId });
  }

  @SubscribeMessage('joinServiceRoom')
  async handleJoinServiceRoom(
    @MessageBody() data: { serviceId: string },
    @ConnectedSocket() client: Socket,
  ) {
    const userId = await this.userOf(client);
    if (!userId || !(await this.serviceRole(data.serviceId, userId))) {
      return { error: 'No autorizado' };
    }
    await client.join(`service:${data.serviceId}`);
    return { joined: `service:${data.serviceId}` };
  }

  @SubscribeMessage('workerLocation')
  async handleWorkerLocation(
    @MessageBody() data: { serviceId: string; lat: number; lng: number },
    @ConnectedSocket() client: Socket,
  ) {
    const workerId = await this.userOf(client);
    // Solo el trabajador asignado puede emitir su ubicación.
    if (!workerId || (await this.serviceRole(data.serviceId, workerId)) !== 'worker') {
      return;
    }

    this.server.to(`service:${data.serviceId}`).emit('workerLocationUpdate', {
      lat: data.lat,
      lng: data.lng,
      workerId,
      timestamp: new Date().toISOString(),
    });
  }
}
