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

  async handleConnection(client: Socket) {
    const token =
      (client.handshake.auth?.token as string | undefined) ??
      (client.handshake.headers?.authorization as string | undefined)?.replace(
        'Bearer ',
        '',
      );

    if (!token) {
      client.disconnect();
      return;
    }

    const { data, error } =
      await this.supabaseService.client.auth.getUser(token);

    if (error || !data.user) {
      client.disconnect();
      return;
    }

    client.data.userId = data.user.id;
    console.log(`Cliente conectado: ${client.id} (user: ${data.user.id})`);
  }

  @SubscribeMessage('joinRoom')
  async handleJoinRoom(
    @MessageBody() data: { roomId: string; userId: string },
    @ConnectedSocket() client: Socket,
  ) {
    const userId: string = client.data.userId ?? data.userId;

    const room = await this.chatService.getRoomById(data.roomId);

    if (room.client_id !== userId && room.worker_id !== userId) {
      return { error: 'No autorizado' };
    }

    client.join(data.roomId);

    return { message: `Unido a la sala ${data.roomId}` };
  }

  @SubscribeMessage('leaveRoom')
  handleLeaveRoom(
    @MessageBody() data: { roomId: string },
    @ConnectedSocket() client: Socket,
  ) {
    client.leave(data.roomId);

    return { message: `Saliste de la sala ${data.roomId}` };
  }

  @SubscribeMessage('sendMessage')
  async handleSendMessage(
    @MessageBody()
    data: {
      roomId: string;
      senderId: string;
      content?: string;
      attachmentUrl?: string;
    },
    @ConnectedSocket() client: Socket,
  ) {
    const senderId: string = client.data.userId ?? data.senderId;

    const message = await this.chatService.sendMessage({
      ...data,
      senderId,
    });

    this.server.to(data.roomId).emit('newMessage', message);

    return message;
  }

  @SubscribeMessage('markAsRead')
  async handleMarkAsRead(
    @MessageBody() data: { roomId: string; userId: string },
    @ConnectedSocket() client: Socket,
  ) {
    const userId: string = client.data.userId ?? data.userId;

    await this.chatService.markMessagesAsRead(data.roomId, userId);

    this.server.to(data.roomId).emit('messagesRead', {
      roomId: data.roomId,
      userId,
    });

    return { ok: true };
  }

  @SubscribeMessage('typing')
  handleTyping(
    @MessageBody() data: { roomId: string },
    @ConnectedSocket() client: Socket,
  ) {
    const userId: string = client.data.userId;
    client.to(data.roomId).emit('peerTyping', { roomId: data.roomId, userId });
  }

  @SubscribeMessage('stopTyping')
  handleStopTyping(
    @MessageBody() data: { roomId: string },
    @ConnectedSocket() client: Socket,
  ) {
    const userId: string = client.data.userId;
    client.to(data.roomId).emit('peerStopTyping', { roomId: data.roomId, userId });
  }

  @SubscribeMessage('joinServiceRoom')
  handleJoinServiceRoom(
    @MessageBody() data: { serviceId: string },
    @ConnectedSocket() client: Socket,
  ) {
    client.join(`service:${data.serviceId}`);
    return { joined: `service:${data.serviceId}` };
  }

  @SubscribeMessage('workerLocation')
  handleWorkerLocation(
    @MessageBody() data: { serviceId: string; lat: number; lng: number },
    @ConnectedSocket() client: Socket,
  ) {
    const workerId: string = client.data.userId;
    if (!workerId) return;

    this.server.to(`service:${data.serviceId}`).emit('workerLocationUpdate', {
      lat: data.lat,
      lng: data.lng,
      workerId,
      timestamp: new Date().toISOString(),
    });
  }
}
