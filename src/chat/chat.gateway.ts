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

@WebSocketGateway({
  cors: {
    origin: '*',
  },
})
export class ChatGateway implements OnGatewayConnection {
  @WebSocketServer()
  server: Server;

  constructor(private readonly chatService: ChatService) {}

  handleConnection(client: Socket) {
    console.log(`Cliente conectado: ${client.id}`);
  }

  @SubscribeMessage('joinRoom')
  async handleJoinRoom(
    @MessageBody() data: { roomId: string; userId: string },
    @ConnectedSocket() client: Socket,
  ) {
    // validar que pertenece a la sala
    const room = await this.chatService.getRoomById(data.roomId);

    if (
      room.client_id !== data.userId &&
      room.worker_id !== data.userId
    ) {
      return { error: 'No autorizado' };
    }

    client.join(data.roomId);

    return { message: `Unido a la sala ${data.roomId}` };
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
  ) {
    const message = await this.chatService.sendMessage(data);

    this.server.to(data.roomId).emit('newMessage', message);

    return message;
  }

  @SubscribeMessage('markAsRead')
  async handleMarkAsRead(
    @MessageBody() data: { roomId: string; userId: string },
  ) {
    await this.chatService.markMessagesAsRead(data.roomId, data.userId);

    this.server.to(data.roomId).emit('messagesRead', {
      roomId: data.roomId,
      userId: data.userId,
    });

    return { ok: true };
  }
}