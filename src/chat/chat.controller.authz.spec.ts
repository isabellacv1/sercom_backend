import { ForbiddenException } from '@nestjs/common';
import { ChatController } from './chat.controller';

/** El chat toma la identidad del token y solo permite a los participantes. */
describe('ChatController · autorización', () => {
  const room = { id: 'r1', client_id: 'client', worker_id: 'worker' };
  const chatService = {
    getRoomById: jest.fn().mockResolvedValue(room),
    getRoomByServiceId: jest.fn().mockResolvedValue(room),
    getMessagesByRoomId: jest.fn().mockResolvedValue([]),
    sendMessage: jest.fn().mockResolvedValue({ id: 'm1' }),
    markMessagesAsRead: jest.fn().mockResolvedValue({}),
    getUserRooms: jest.fn().mockResolvedValue([]),
  };
  const controller = new ChatController(chatService as never);

  beforeEach(() => jest.clearAllMocks());

  it('un no participante no puede leer mensajes', async () => {
    await expect(controller.getMessages('r1', { sub: 'intruso' })).rejects.toBeInstanceOf(
      ForbiddenException,
    );
    expect(chatService.getMessagesByRoomId).not.toHaveBeenCalled();
  });

  it('un participante sí puede leer mensajes', async () => {
    await controller.getMessages('r1', { sub: 'worker' });
    expect(chatService.getMessagesByRoomId).toHaveBeenCalledWith('r1');
  });

  it('el remitente siempre es el usuario del token (no se puede suplantar)', async () => {
    await controller.sendMessage(
      { roomId: 'r1', senderId: 'client', content: 'hola' },
      { sub: 'worker' },
    );
    expect(chatService.sendMessage).toHaveBeenCalledWith(
      expect.objectContaining({ senderId: 'worker' }),
    );
  });

  it('no se pueden listar las salas de otro usuario', () => {
    expect(() => controller.getUserRooms('otro', { sub: 'client' })).toThrow(ForbiddenException);
  });

  it('la sala de un servicio solo la ven sus participantes', async () => {
    await expect(controller.getRoomByService('s1', { sub: 'intruso' })).rejects.toBeInstanceOf(
      ForbiddenException,
    );
  });
});
