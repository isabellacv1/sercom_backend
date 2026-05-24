import {
  Body,
  Controller,
  Get,
  Headers,
  HttpCode,
  Param,
  Post,
  Query,
  Req,
  UseGuards,
} from '@nestjs/common';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { PaymentsService } from './payments.service';
import { CreateMercadoPagoLinkDto } from './dto/create-mercadopago-link.dto';
import { ConfirmMercadoPagoPaymentDto } from './dto/confirm-mercadopago-payment.dto';
import { ReleasePaymentDto } from './dto/release-payment.dto';
import { RefundPaymentDto } from './dto/refund-payment.dto';

type JwtUser = { sub: string };

/**
 * Rutas protegidas por JWT — requieren que el cliente/técnico/admin esté autenticado.
 *
 * Payloads de ejemplo:
 *
 * POST /payments/mercadopago/link
 * { "service_id": "uuid-del-servicio" }
 *
 * GET /payments/service/:serviceId
 * GET /payments/:paymentId
 * GET /payments/:paymentId/receipt
 * GET /payments/:paymentId/audit
 *
 * PATCH /payments/:paymentId/confirm-mercadopago  (solo admin)
 * { "result": "approved", "provider_reference": "MP-123456", "note": "Verificado en portal" }
 *
 * POST /payments/:paymentId/release  (solo admin)
 * { "note": "Servicio completado y confirmado por ambas partes" }
 *
 * POST /payments/:paymentId/refund   (solo admin)
 * { "reason": "Servicio no completado" }
 */
@UseGuards(JwtAuthGuard)
@Controller('payments')
export class PaymentsController {
  constructor(private readonly paymentsService: PaymentsService) {}

  // ─── Crear link de pago / Checkout Pro preference ────────────────────────

  @Post('mercadopago/link')
  createCheckoutPreference(
    @CurrentUser() user: JwtUser,
    @Body() dto: CreateMercadoPagoLinkDto,
  ) {
    return this.paymentsService.createCheckoutPreference(user.sub, dto);
  }

  // ─── Wallet y balance del trabajador ─────────────────────────────────────

  @Get('worker/wallet')
  getWorkerWallet(@CurrentUser() user: JwtUser) {
    return this.paymentsService.getWorkerWallet(user.sub);
  }

  @Get('worker/balance')
  getWorkerBalance(@CurrentUser() user: JwtUser) {
    return this.paymentsService.getWorkerBalance(user.sub);
  }

  // ─── Consultar pagos ──────────────────────────────────────────────────────

  @Get('service/:serviceId')
  findByService(
    @CurrentUser() user: JwtUser,
    @Param('serviceId') serviceId: string,
  ) {
    return this.paymentsService.findByService(user.sub, serviceId);
  }

  @Get(':paymentId')
  findById(
    @CurrentUser() user: JwtUser,
    @Param('paymentId') paymentId: string,
  ) {
    return this.paymentsService.findById(user.sub, paymentId);
  }

  @Get(':paymentId/receipt')
  getReceipt(
    @CurrentUser() user: JwtUser,
    @Param('paymentId') paymentId: string,
  ) {
    return this.paymentsService.getReceipt(user.sub, paymentId);
  }

  @Get(':paymentId/audit')
  getAuditLogs(
    @CurrentUser() user: JwtUser,
    @Param('paymentId') paymentId: string,
  ) {
    return this.paymentsService.getAuditLogs(user.sub, paymentId);
  }

  // ─── Acciones de admin ────────────────────────────────────────────────────

  @Post(':paymentId/confirm-mercadopago')
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

  @Post(':paymentId/release')
  releasePayment(
    @CurrentUser() user: JwtUser,
    @Param('paymentId') paymentId: string,
    @Body() dto: ReleasePaymentDto,
  ) {
    return this.paymentsService.releasePayment(user.sub, paymentId, dto);
  }

  @Post(':paymentId/refund')
  refundPayment(
    @CurrentUser() user: JwtUser,
    @Param('paymentId') paymentId: string,
    @Body() dto: RefundPaymentDto,
  ) {
    return this.paymentsService.refundPayment(user.sub, paymentId, dto);
  }
}

/**
 * Controlador separado para el webhook de Mercado Pago.
 * NO usa JwtAuthGuard — MP llama directamente este endpoint.
 * La autenticidad se verifica internamente con la firma HMAC-SHA256.
 *
 * Configurar en el portal de MP:
 *   URL: https://tu-dominio.com/payments/webhook/mercadopago
 *   Eventos: Pagos (payment)
 */
@Controller('payments/webhook')
export class PaymentsWebhookController {
  constructor(private readonly paymentsService: PaymentsService) {}

  @Post('mercadopago')
  @HttpCode(200)
  handleMercadoPagoWebhook(
    @Headers('x-signature') xSignature: string | undefined,
    @Headers('x-request-id') xRequestId: string | undefined,
    @Query() query: Record<string, string>,
    @Body() body: any,
  ) {
    return this.paymentsService.handleWebhook(
      xSignature,
      xRequestId,
      query,
      body,
    );
  }
}
