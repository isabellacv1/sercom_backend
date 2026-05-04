import {
  Body,
  Controller,
  Get,
  Param,
  Patch,
  Post,
  UseGuards,
} from '@nestjs/common';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { PaymentsService } from './payments.service';
import { CreateMercadoPagoLinkDto } from './dto/create-mercadopago-link.dto';
import { ConfirmMercadoPagoPaymentDto } from './dto/confirm-mercadopago-payment.dto';

type JwtUser = {
  sub: string;
  email?: string;
  role?: string;
};

@UseGuards(JwtAuthGuard)
@Controller('payments')
export class PaymentsController {
  constructor(private readonly paymentsService: PaymentsService) {}

  @Post('mercadopago/link')
  createMercadoPagoLink(
    @CurrentUser() user: JwtUser,
    @Body() dto: CreateMercadoPagoLinkDto,
  ) {
    return this.paymentsService.createMercadoPagoLink(user.sub, dto);
  }

  @Get('service/:serviceId')
  findByService(
    @CurrentUser() user: JwtUser,
    @Param('serviceId') serviceId: string,
  ) {
    return this.paymentsService.findByService(user.sub, serviceId);
  }

  /**
   * Confirmación manual por admin/plataforma.
   * Se usa porque el link fijo de Mercado Pago no viene asociado
   * automáticamente a un service_id de tu sistema.
   */
  @Patch(':paymentId/confirm-mercadopago')
  confirmMercadoPagoPayment(
    @CurrentUser() user: JwtUser,
    @Param('paymentId') paymentId: string,
    @Body() dto: ConfirmMercadoPagoPaymentDto,
  ) {
    return this.paymentsService.confirmMercadoPagoPayment(
      user.sub,
      paymentId,
      dto,
    );
  }
}