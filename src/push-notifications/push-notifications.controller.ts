import { Body, Controller, Delete, HttpCode, Post, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { PushNotificationsService } from './push-notifications.service';
import { RegisterTokenDto } from './dto/register-token.dto';

type JwtUser = { sub: string };

@UseGuards(JwtAuthGuard)
@Controller('push-tokens')
export class PushNotificationsController {
  constructor(private readonly pushService: PushNotificationsService) {}

  /**
   * POST /push-tokens/register
   * El app llama esto al iniciar sesión o al obtener un nuevo token FCM.
   */
  @Post('register')
  async register(
    @CurrentUser() user: JwtUser,
    @Body() dto: RegisterTokenDto,
  ) {
    await this.pushService.registerToken(user.sub, dto);
    return { message: 'Token registrado correctamente' };
  }

  /**
   * DELETE /push-tokens/deactivate
   * El app llama esto al cerrar sesión para dejar de recibir notificaciones.
   */
  @Delete('deactivate')
  @HttpCode(200)
  async deactivate(@CurrentUser() user: JwtUser) {
    await this.pushService.deactivateTokensForUser(user.sub);
    return { message: 'Tokens desactivados correctamente' };
  }
}
