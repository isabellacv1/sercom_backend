import {
  Body,
  Controller,
  Get,
  HttpCode,
  Param,
  Post,
  Put,
  UseGuards,
} from '@nestjs/common';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { PaymentsService } from './payments.service';
import { CreateCheckoutDto } from './dto/create-checkout.dto';
import { ConfirmManualPaymentDto } from './dto/confirm-manual-payment.dto';
import { ReleasePaymentDto } from './dto/release-payment.dto';
import { RefundPaymentDto } from './dto/refund-payment.dto';
import { CompletePayoutDto } from './dto/complete-payout.dto';
import type { WompiEvent } from './wompi.service';
import { PayoutAccountService } from './payout-account.service';
import { PayoutAccountDto } from './dto/payout-account.dto';
import { getFeeRates } from './fees';

type JwtUser = { sub: string };

/**
 * Rutas protegidas por JWT — requieren que el cliente/técnico/admin esté autenticado.
 *
 * Payloads de ejemplo:
 *
 * POST /payments/checkout
 * { "service_id": "uuid-del-servicio" }
 *
 * GET /payments/service/:serviceId
 * GET /payments/:paymentId
 * GET /payments/:paymentId/receipt
 * GET /payments/:paymentId/audit
 *
 * POST /payments/:paymentId/confirm-manual  (solo admin)
 * { "result": "approved", "provider_reference": "WOMPI-123456", "note": "Verificado en portal" }
 *
 * POST /payments/:paymentId/release  (solo admin)
 * { "note": "Servicio completado y confirmado por ambas partes" }
 *
 * POST /payments/:paymentId/refund   (solo admin)
 * { "reason": "Servicio no completado", "manual_reference": "NEQUI-998877" }
 *
 * GET  /payments/admin/payouts        (solo admin) transferencias pendientes
 * POST /payments/:paymentId/payout    (solo admin)
 * { "reference": "NEQUI-112233", "method": "nequi" }
 */
@UseGuards(JwtAuthGuard)
@Controller('payments')
export class PaymentsController {
  constructor(
    private readonly paymentsService: PaymentsService,
    private readonly payoutAccountService: PayoutAccountService,
  ) {}

  // ─── Crear checkout Wompi ─────────────────────────────────────────────────

  @Post('checkout')
  createCheckout(@CurrentUser() user: JwtUser, @Body() dto: CreateCheckoutDto) {
    return this.paymentsService.createCheckout(user.sub, dto);
  }

  // ─── Tasas de comisión vigentes (para mostrar el desglose en la app) ────

  @Get('fees')
  getFees() {
    const rates = getFeeRates();
    return {
      client_fee_rate: rates.clientFeeRate,
      worker_commission_rate: rates.workerCommissionRate,
    };
  }

  // ─── Transferencias pendientes a técnicos (admin) ────────────────────────
  // Debe declararse antes de ':paymentId' para no colisionar con esa ruta.

  @Get('admin/payouts')
  listPendingPayouts(@CurrentUser() user: JwtUser) {
    return this.paymentsService.listPendingPayouts(user.sub);
  }

  // ─── Wallet y balance del trabajador ─────────────────────────────────────

  @Get('worker/wallet')
  getWorkerWallet(@CurrentUser() user: JwtUser) {
    return this.paymentsService.getWorkerWallet(user.sub);
  }

  // ─── Dónde recibe sus pagos el trabajador ────────────────────────────────

  @Get('worker/payout-account')
  getPayoutAccount(@CurrentUser() user: JwtUser) {
    return this.payoutAccountService.get(user.sub);
  }

  @Put('worker/payout-account')
  savePayoutAccount(
    @CurrentUser() user: JwtUser,
    @Body() dto: PayoutAccountDto,
  ) {
    return this.payoutAccountService.upsert(user.sub, dto);
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

  @Post(':paymentId/confirm-manual')
  confirmManualPayment(
    @CurrentUser() user: JwtUser,
    @Param('paymentId') paymentId: string,
    @Body() dto: ConfirmManualPaymentDto,
  ) {
    return this.paymentsService.confirmManualPayment(
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

  @Post(':paymentId/payout')
  completePayout(
    @CurrentUser() user: JwtUser,
    @Param('paymentId') paymentId: string,
    @Body() dto: CompletePayoutDto,
  ) {
    return this.paymentsService.completePayout(user.sub, paymentId, dto);
  }
}

/**
 * Controlador separado para los eventos de Wompi.
 * NO usa JwtAuthGuard — Wompi llama directamente este endpoint.
 * La autenticidad se verifica con el checksum del evento (WOMPI_EVENTS_SECRET)
 * y reconsultando la transacción en la API de Wompi.
 *
 * Configurar en el dashboard de Wompi → Desarrolladores → URL de eventos:
 *   https://sercom-backend.onrender.com/payments/webhook/wompi
 */
@Controller('payments/webhook')
export class PaymentsWebhookController {
  constructor(private readonly paymentsService: PaymentsService) {}

  @Post('wompi')
  @HttpCode(200)
  handleWompiEvent(@Body() body: WompiEvent) {
    return this.paymentsService.handleWompiEvent(body);
  }
}
