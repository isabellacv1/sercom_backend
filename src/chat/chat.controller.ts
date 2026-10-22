import {
  Body,
  Controller,
  ForbiddenException,
  Get,
  Param,
  Patch,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import { ChatService } from './chat.service';
import { CreateMessageDto } from './dto/create-message.dto';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import {
  CurrentUser,
  JwtUser,
} from '../auth/decorators/current-user.decorator';

/**
 * Todas las rutas exigen sesión. La identidad sale SIEMPRE del token: los
 * `senderId` / `userId` que envía el cliente se ignoran para evitar leer o
 * escribir conversaciones ajenas.
 */
@UseGuards(JwtAuthGuard)
@Controller('chat')
export class ChatController {
  constructor(private readonly chatService: ChatService) {}

  private assertMember(
    room: { client_id: string | null; worker_id: string | null },
    userId: string,
  ) {
    if (room.client_id !== userId && room.worker_id !== userId) {
      throw new ForbiddenException('No perteneces a esta conversación');
    }
  }

  @Get('service/:serviceId/room')
  async getRoomByService(
    @Param('serviceId') serviceId: string,
    @CurrentUser() user: JwtUser,
  ) {
    const room = await this.chatService.getRoomByServiceId(serviceId);
    this.assertMember(room, user.sub);
    return room;
  }

  @Get('rooms/:roomId/messages')
  async getMessages(
    @Param('roomId') roomId: string,
    @CurrentUser() user: JwtUser,
  ) {
    this.assertMember(await this.chatService.getRoomById(roomId), user.sub);
    return this.chatService.getMessagesByRoomId(roomId);
  }

  @Post('messages')
  async sendMessage(
    @Body() dto: CreateMessageDto,
    @CurrentUser() user: JwtUser,
  ) {
    return this.chatService.sendMessage({ ...dto, senderId: user.sub });
  }

  @Patch('rooms/:roomId/read')
  async markAsRead(
    @Param('roomId') roomId: string,
    @CurrentUser() user: JwtUser,
  ) {
    this.assertMember(await this.chatService.getRoomById(roomId), user.sub);
    return this.chatService.markMessagesAsRead(roomId, user.sub);
  }

  @Get('users/:userId/rooms')
  getUserRooms(
    @Param('userId') userId: string,
    @CurrentUser() user: JwtUser,
    @Query('role') role?: 'client' | 'worker' | 'all',
  ) {
    if (userId !== user.sub) {
      throw new ForbiddenException('Solo puedes ver tus conversaciones');
    }
    return this.chatService.getUserRooms(user.sub, role ?? 'all');
  }
}
