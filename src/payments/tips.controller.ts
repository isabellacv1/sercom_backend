import { Body, Controller, Get, Param, ParseUUIDPipe, Post } from '@nestjs/common';
import { Auth } from '../auth/decorators/auth.decorator';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import type { JwtUser } from '../auth/decorators/current-user.decorator';
import { AppRoles } from '../auth/interfaces/app-roles';
import { CreateTipDto } from './dto/create-tip.dto';
import { CompletePayoutDto } from './dto/complete-payout.dto';
import { TipsService } from './tips.service';

@Controller('tips')
export class TipsController {
  constructor(private readonly tips: TipsService) {}

  // GET /tips/service/:serviceId — propina del servicio (cliente o técnico)
  @Auth()
  @Get('service/:serviceId')
  getForService(
    @CurrentUser() user: JwtUser,
    @Param('serviceId', ParseUUIDPipe) serviceId: string,
  ) {
    return this.tips.getForService(user.sub, serviceId);
  }

  // POST /tips/service/:serviceId/checkout { amount } — link de pago Wompi
  @Auth(AppRoles.CLIENT)
  @Post('service/:serviceId/checkout')
  checkout(
    @CurrentUser() user: JwtUser,
    @Param('serviceId', ParseUUIDPipe) serviceId: string,
    @Body() dto: CreateTipDto,
  ) {
    return this.tips.createCheckout(user.sub, serviceId, dto);
  }

  // POST /tips/:id/payout { reference } — admin registra la transferencia
  @Auth(AppRoles.ADMIN)
  @Post(':id/payout')
  completePayout(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: CompletePayoutDto,
  ) {
    return this.tips.completePayout(id, dto);
  }
}
