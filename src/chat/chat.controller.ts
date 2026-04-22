import { Body, Controller, Get, Param, Patch, Post } from '@nestjs/common';
import { ChatService } from './chat.service';
import { CreateMessageDto } from './dto/create-message.dto';
import { MarkReadDto } from './dto/mark-read.dto';

@Controller('chat')
export class ChatController {

  constructor(private readonly chatService: ChatService) {}

  @Get('service/:serviceId/room')
  async getRoomByService(@Param('serviceId') serviceId: string) {
    return this.chatService.getRoomByServiceId(serviceId);
  }

  @Get('rooms/:roomId/messages')
  async getMessages(@Param('roomId') roomId: string) {
    return this.chatService.getMessagesByRoomId(roomId);
  }

  @Post('messages')
  async sendMessage(@Body() dto: CreateMessageDto) {
    return this.chatService.sendMessage(dto);
  }


  @Patch('rooms/:roomId/read')
  async markAsRead(
    @Param('roomId') roomId: string,
    @Body() dto: MarkReadDto,
  ) {
    return this.chatService.markMessagesAsRead(roomId, dto.userId);
  }

    @Get('users/:userId/rooms')
    getUserRooms(@Param('userId') userId: string) {
        return this.chatService.getUserRooms(userId);
    }



}