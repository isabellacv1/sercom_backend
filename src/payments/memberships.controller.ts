import { Controller, Get, Post } from '@nestjs/common';
import { Auth } from '../auth/decorators/auth.decorator';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import type { JwtUser } from '../auth/decorators/current-user.decorator';
import { AppRoles } from '../auth/interfaces/app-roles';
import { MembershipsService } from './memberships.service';

@Controller('memberships')
export class MembershipsController {
  constructor(private readonly memberships: MembershipsService) {}

  // GET /memberships/me — estado Pro, vencimiento, uso del plan gratuito
  @Auth(AppRoles.WORKER)
  @Get('me')
  getMine(@CurrentUser() user: JwtUser) {
    return this.memberships.getMine(user.sub);
  }

  // POST /memberships/pro/checkout — link de pago Wompi
  @Auth(AppRoles.WORKER)
  @Post('pro/checkout')
  checkout(@CurrentUser() user: JwtUser) {
    return this.memberships.createCheckout(user.sub, 'pro');
  }

  // GET /memberships/plus — SERCOM Plus del cliente
  @Auth()
  @Get('plus')
  getPlus(@CurrentUser() user: JwtUser) {
    return this.memberships.getPlus(user.sub);
  }

  // POST /memberships/plus/checkout — link de pago Wompi
  @Auth()
  @Post('plus/checkout')
  checkoutPlus(@CurrentUser() user: JwtUser) {
    return this.memberships.createCheckout(user.sub, 'plus');
  }
}
