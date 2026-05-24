import {
  Controller,
  Delete,
  Get,
  Query,
  Redirect,
  Res,
  UseGuards,
} from '@nestjs/common';
import { Response } from 'express';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { MpOAuthService } from './mp-oauth.service';

type JwtUser = { sub: string };

@Controller('oauth/mercadopago')
export class MpOAuthController {
  constructor(private readonly mpOAuthService: MpOAuthService) {}

  // ─── 1. Iniciar OAuth: devuelve la URL de autorización de MP ────────────────
  // Flutter llama este endpoint → recibe la URL → la abre en el navegador

  @UseGuards(JwtAuthGuard)
  @Get('connect')
  getAuthorizeUrl(@CurrentUser() user: JwtUser) {
    const url = this.mpOAuthService.generateAuthorizeUrl(user.sub);
    return { authorize_url: url };
  }

  // ─── 2. Callback: MP redirige aquí con el código de autorización ─────────────
  // Este endpoint es público (MP lo llama directamente).
  // Después de guardar los tokens, redirige al frontend.

  @Get('callback')
  async handleCallback(
    @Query('code') code: string,
    @Query('state') state: string,
    @Res() res: Response,
  ) {
    try {
      const { redirectUrl } = await this.mpOAuthService.handleCallback(code, state);
      return res.redirect(redirectUrl);
    } catch (err: any) {
      const frontendUrl = process.env.MP_FRONTEND_URL ?? '';
      return res.redirect(`${frontendUrl}/oauth/error?message=${encodeURIComponent(err.message)}`);
    }
  }

  // ─── 3. Estado de conexión ─────────────────────────���─────────────────────────
  // Flutter usa este endpoint para saber si el trabajador tiene su cuenta conectada.

  @UseGuards(JwtAuthGuard)
  @Get('status')
  getStatus(@CurrentUser() user: JwtUser) {
    return this.mpOAuthService.getConnectionStatus(user.sub);
  }

  // ─── 4. Desconectar cuenta ────────────────────────��──────────────────────────

  @UseGuards(JwtAuthGuard)
  @Delete('disconnect')
  async disconnect(@CurrentUser() user: JwtUser) {
    await this.mpOAuthService.disconnectWorker(user.sub);
    return { message: 'Cuenta Mercado Pago desconectada correctamente.' };
  }
}
