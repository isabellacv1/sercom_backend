import {
  ServiceUnavailableException,
  BadRequestException,
  ForbiddenException,
  Injectable,
  InternalServerErrorException,
  Logger,
  NotFoundException,
  UnauthorizedException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { SupabaseService } from '../supabase/supabase.service';
import { PushNotificationsService } from '../push-notifications/push-notifications.service';
import {
  WompiEvent,
  WompiService,
  WompiTransaction,
} from './wompi.service';
import { CreateCheckoutDto } from './dto/create-checkout.dto';
import { ConfirmManualPaymentDto } from './dto/confirm-manual-payment.dto';
import { ReleasePaymentDto } from './dto/release-payment.dto';
import { RefundPaymentDto } from './dto/refund-payment.dto';
import { CompletePayoutDto } from './dto/complete-payout.dto';
import { PayoutAccountService } from './payout-account.service';

type PaymentStatus =
  | 'pending'
  | 'held'
  | 'released'
  | 'refunded'
  | 'failed'
  | 'disbursed';

/**
 * Pagos con custodia SerCom sobre Wompi.
 *
 *   pending ──(Wompi APPROVED)──▶ held ──(ambas partes confirman)──▶ released
 *      │                           │                                   │
 *      └─(DECLINED/ERROR)▶ failed  └─(admin)▶ refunded   (admin transfiere)▶ disbursed
 *
 * Todo el dinero entra a la cuenta Wompi de SerCom. La transferencia al
 * técnico es manual: el admin la hace por fuera (Nequi / banco) y la
 * registra con POST /payments/:id/payout.
 */
@Injectable()
export class PaymentsService {
  private readonly logger = new Logger(PaymentsService.name);
  private readonly frontendUrl: string;

  constructor(
    private readonly supabaseService: SupabaseService,
    private readonly configService: ConfigService,
    private readonly pushService: PushNotificationsService,
    private readonly wompi: WompiService,
    private readonly payoutAccounts: PayoutAccountService,
  ) {
    this.frontendUrl =
      this.configService.get<string>('PAYMENTS_FRONTEND_URL') ??
      this.configService.get<string>('MP_FRONTEND_URL') ??
      this.configService.get<string>('APP_URL') ??
      '';
  }

  private get db() {
    return this.supabaseService.sbRaw;
  }

  // ─── Crear checkout Wompi ───────────────────────────────────────────────────

  async createCheckout(clientId: string, dto: CreateCheckoutDto) {
    if (!this.wompi.isConfigured) {
      throw new ServiceUnavailableException(
        'Los pagos no están configurados en este servidor.',
      );
    }

    const service = await this.requireServiceForClient(
      dto.service_id,
      clientId,
    );

    if (!service.assigned_worker_id) {
      throw new BadRequestException('El servicio no tiene técnico asignado');
    }

    let payment = await this.requirePendingPayment(service.id, clientId);

    // Antes de generar otro checkout, verificar si un intento previo ya se pagó.
    payment = await this.syncWithProvider(payment);

    if (payment.status === 'held') {
      const svc = await this.getServiceBasicData(service.id);
      return {
        message: 'El pago ya fue aprobado y está retenido por la plataforma',
        payment,
        receipt: this.buildReceipt(payment, svc),
      };
    }

    this.guardFinalStatus(payment.status as PaymentStatus);

    if (payment.provider_status === 'PENDING' && payment.checkout_url) {
      // Hay una transacción en curso (p. ej. PSE / Nequi esperando aprobación):
      // no abrir un segundo cobro.
      return this.buildCheckoutResponse(payment, payment.checkout_url);
    }

    const { data: clientProfile } = await this.db
      .from('profiles')
      .select('full_name, email')
      .eq('id', clientId)
      .maybeSingle();

    // Wompi exige referencia única por transacción: cada intento usa una nueva.
    const reference = `${payment.id}_${Date.now().toString(36)}`;
    const checkoutUrl = this.wompi.buildCheckoutUrl({
      reference,
      amountInCents: this.toCents(payment.amount_total),
      currency: payment.currency ?? 'COP',
      redirectUrl: this.frontendUrl || 'https://sercom-frontend.vercel.app',
      customerEmail: clientProfile?.email,
      customerName: clientProfile?.full_name,
    });

    const { data: updated, error: updateError } = await this.db
      .from('payments')
      .update({
        checkout_reference: reference,
        checkout_url: checkoutUrl,
        provider: 'wompi',
        payment_method: 'wompi_checkout',
        payment_mode: 'platform',
        updated_at: new Date().toISOString(),
      })
      .eq('id', payment.id)
      .select()
      .single();

    if (updateError)
      throw new InternalServerErrorException(updateError.message);

    await this.logAudit({
      payment_id: payment.id,
      previous_status: payment.status,
      new_status: payment.status,
      source: 'client',
      changed_by: clientId,
      note: `Checkout Wompi generado: ${reference}`,
      metadata: { checkout_reference: reference, sandbox: this.wompi.isSandbox },
    });

    return this.buildCheckoutResponse(updated, checkoutUrl);
  }

  // ─── Consultar pago por servicio ────────────────────────────────────────────

  async findByService(userId: string, serviceId: string) {
    const { data, error } = await this.db
      .from('payments')
      .select('*')
      .eq('service_id', serviceId)
      .maybeSingle();

    if (error) throw new InternalServerErrorException(error.message);
    if (!data) throw new NotFoundException('Pago no encontrado');

    await this.requireParticipantOrAdmin(userId, data);

    // Respaldo del webhook: si el pago sigue pendiente, consultar a Wompi.
    const payment = await this.syncWithProvider(data);

    const service = await this.getServiceBasicData(serviceId);
    return {
      payment,
      receipt: this.hasReceipt(payment)
        ? this.buildReceipt(payment, service)
        : null,
    };
  }

  // ─── Consultar pago por ID ──────────────────────────────────────────────────

  async findById(userId: string, paymentId: string) {
    const payment = await this.requirePayment(paymentId);
    await this.requireParticipantOrAdmin(userId, payment);

    const service = await this.getServiceBasicData(payment.service_id);
    return {
      payment,
      receipt: this.hasReceipt(payment)
        ? this.buildReceipt(payment, service)
        : null,
    };
  }

  // ─── Obtener comprobante digital ────────────────────────────────────────────

  async getReceipt(userId: string, paymentId: string) {
    const payment = await this.requirePayment(paymentId);
    await this.requireParticipantOrAdmin(userId, payment);

    if (!this.hasReceipt(payment)) {
      throw new BadRequestException(
        'El comprobante solo está disponible para pagos aprobados o liberados',
      );
    }

    const service = await this.getServiceBasicData(payment.service_id);
    return { receipt: this.buildReceipt(payment, service) };
  }

  // ─── Confirmación manual por admin ──────────────────────────────────────────

  async confirmManualPayment(
    userId: string,
    paymentId: string,
    dto: ConfirmManualPaymentDto,
  ) {
    await this.requireAdmin(
      userId,
      'Solo un administrador puede confirmar pagos manualmente',
    );

    const payment = await this.requirePayment(paymentId);
    const status = payment.status as PaymentStatus;

    if (status === 'held') {
      throw new BadRequestException(
        'Este pago ya fue confirmado anteriormente',
      );
    }
    this.guardFinalStatus(status);

    const now = new Date().toISOString();

    if (dto.result === 'rejected') {
      const { data: failed, error: failErr } = await this.db
        .from('payments')
        .update({
          status: 'failed',
          provider_reference: dto.provider_reference ?? null,
          updated_at: now,
        })
        .eq('id', paymentId)
        .select()
        .single();

      if (failErr) throw new InternalServerErrorException(failErr.message);

      await this.logAudit({
        payment_id: paymentId,
        previous_status: status,
        new_status: 'failed',
        source: 'admin',
        changed_by: userId,
        note: dto.note ?? 'Pago rechazado por administrador',
        metadata: { provider_reference: dto.provider_reference },
      });

      return {
        message: 'Pago rechazado. El servicio no puede iniciar.',
        payment: failed,
      };
    }

    const receiptNumber = this.receiptNumberFor(paymentId);
    const { data: held, error: heldErr } = await this.db
      .from('payments')
      .update({
        status: 'held',
        paid_at: now,
        receipt_number: receiptNumber,
        provider_reference: dto.provider_reference ?? receiptNumber,
        updated_at: now,
      })
      .eq('id', paymentId)
      .select()
      .single();

    if (heldErr) throw new InternalServerErrorException(heldErr.message);

    await this.logAudit({
      payment_id: paymentId,
      previous_status: status,
      new_status: 'held',
      source: 'admin',
      changed_by: userId,
      note: dto.note ?? 'Pago aprobado manualmente por administrador',
      metadata: { provider_reference: dto.provider_reference },
    });

    await this.notifyPaymentHeld(held);

    const service = await this.getServiceBasicData(held.service_id);
    return {
      message:
        'Pago aprobado. El dinero queda retenido bajo custodia de la plataforma.',
      payment: held,
      receipt: this.buildReceipt(held, service),
    };
  }

  // ─── Webhook (eventos) de Wompi ─────────────────────────────────────────────

  async handleWompiEvent(event: WompiEvent) {
    const signatureValid = this.wompi.verifyEventSignature(event);
    if (signatureValid === false) {
      this.logger.warn('Evento Wompi con firma inválida, descartado');
      throw new UnauthorizedException('Firma inválida');
    }

    if (event?.event !== 'transaction.updated') {
      return { received: true };
    }

    const transactionId = event.data?.transaction?.id;
    if (!transactionId) {
      this.logger.warn('Evento Wompi sin transaction.id');
      return { received: true };
    }

    // La fuente de verdad es la API, no el cuerpo del evento.
    let transaction: WompiTransaction;
    try {
      transaction = await this.wompi.getTransaction(transactionId);
    } catch (err) {
      this.logger.error(
        `Error consultando transacción Wompi ${transactionId}: ${(err as Error).message}`,
      );
      // 5xx para que Wompi reintente el evento.
      throw new ServiceUnavailableException('No se pudo verificar la transacción');
    }

    const paymentId = this.paymentIdFromReference(transaction.reference);
    if (!paymentId) {
      this.logger.warn(
        `Transacción Wompi ${transaction.id} con referencia desconocida: ${transaction.reference}`,
      );
      return { received: true };
    }

    const { data: payment, error } = await this.db
      .from('payments')
      .select('*')
      .eq('id', paymentId)
      .maybeSingle();

    if (error) throw new InternalServerErrorException(error.message);
    if (!payment) {
      this.logger.warn(
        `Transacción Wompi ${transaction.id}: pago ${paymentId} no encontrado`,
      );
      return { received: true };
    }

    await this.applyTransaction(payment, transaction, 'webhook');
    return { received: true };
  }

  // ─── Liberar fondos (admin, manual) ─────────────────────────────────────────

  async releasePayment(
    userId: string,
    paymentId: string,
    dto: ReleasePaymentDto,
  ) {
    await this.requireAdmin(userId, 'Solo un administrador puede liberar fondos');

    const payment = await this.requirePayment(paymentId);

    if (payment.status !== 'held') {
      throw new BadRequestException(
        `Solo se puede liberar un pago en estado 'held'. Estado actual: ${payment.status}`,
      );
    }

    const { data: service } = await this.db
      .from('services')
      .select('status, client_confirmation, worker_confirmation')
      .eq('id', payment.service_id)
      .maybeSingle();

    if (!service || service.status !== 'completed') {
      throw new BadRequestException(
        'El servicio debe estar en estado completado para liberar el pago',
      );
    }

    if (!service.client_confirmation || !service.worker_confirmation) {
      throw new BadRequestException(
        'Ambas partes deben confirmar el servicio antes de liberar el pago',
      );
    }

    const released = await this.markReleased(payment, {
      source: 'admin',
      changedBy: userId,
      note: dto.note,
    });

    const svc = await this.getServiceBasicData(released.service_id);
    return {
      message:
        'Fondos liberados. Queda pendiente la transferencia al técnico.',
      payment: released,
      receipt: this.buildReceipt(released, svc),
    };
  }

  /**
   * Se dispara cuando cliente y técnico confirman el servicio
   * (ServicesService). Libera la custodia y deja el pago listo para que el
   * admin transfiera al técnico.
   */
  async disburseWorkerPayment(serviceId: string): Promise<void> {
    const { data: payment, error } = await this.db
      .from('payments')
      .select('*')
      .eq('service_id', serviceId)
      .eq('status', 'held')
      .maybeSingle();

    if (error) {
      this.logger.error(
        `Error buscando pago held para servicio ${serviceId}: ${error.message}`,
      );
      return;
    }
    if (!payment) {
      this.logger.warn(
        `No se encontró pago en estado 'held' para servicio ${serviceId}`,
      );
      return;
    }

    await this.markReleased(payment, {
      source: 'system',
      note: 'Ambas partes confirmaron el servicio',
    });
  }

  // ─── Transferencias a técnicos (admin) ──────────────────────────────────────

  async listPendingPayouts(userId: string) {
    await this.requireAdmin(
      userId,
      'Solo un administrador puede ver las transferencias pendientes',
    );

    const { data: rows, error } = await this.db
      .from('payments')
      .select(
        `
        id, service_id, worker_id, worker_amount, commission_amount,
        amount_total, currency, released_at, payout_status,
        services:service_id(title)
      `,
      )
      .eq('status', 'released')
      .eq('payout_status', 'pending_manual')
      .order('released_at', { ascending: true });

    if (error) throw new InternalServerErrorException(error.message);

    const workerIds = [
      ...new Set((rows ?? []).map((r) => r.worker_id).filter(Boolean)),
    ];
    const { data: workers } = workerIds.length
      ? await this.db
          .from('profiles')
          .select('id, full_name, email, phone')
          .in('id', workerIds)
      : { data: [] as any[] };
    const workerById = new Map((workers ?? []).map((w) => [w.id, w]));
    const accountByWorker = await this.payoutAccounts.findByWorkers(
      workerIds as string[],
    );

    const payouts = (rows ?? []).map((r) => {
      const worker = workerById.get(r.worker_id);
      return {
        payment_id: r.id,
        service_id: r.service_id,
        service_title: (r.services as any)?.title ?? null,
        worker_id: r.worker_id,
        worker_name: worker?.full_name ?? null,
        worker_email: worker?.email ?? null,
        worker_phone: worker?.phone ?? null,
        // A dónde transferir: Nequi / Daviplata / cuenta bancaria del técnico.
        payout_account: accountByWorker.get(r.worker_id) ?? null,
        worker_amount: Number(r.worker_amount ?? 0),
        commission_amount: Number(r.commission_amount ?? 0),
        amount_total: Number(r.amount_total ?? 0),
        currency: r.currency ?? 'COP',
        released_at: r.released_at,
      };
    });

    return {
      total_pending: payouts.reduce((s, p) => s + p.worker_amount, 0),
      payouts,
    };
  }

  async completePayout(
    userId: string,
    paymentId: string,
    dto: CompletePayoutDto,
  ) {
    await this.requireAdmin(
      userId,
      'Solo un administrador puede registrar transferencias',
    );

    const payment = await this.requirePayment(paymentId);

    if (payment.status === 'disbursed') {
      throw new BadRequestException('Este pago ya fue transferido al técnico');
    }
    if (payment.status !== 'released') {
      throw new BadRequestException(
        `Solo se puede transferir un pago liberado. Estado actual: ${payment.status}`,
      );
    }

    const now = new Date().toISOString();
    const { data: disbursed, error } = await this.db
      .from('payments')
      .update({
        status: 'disbursed',
        payout_status: 'completed',
        disbursed_at: now,
        external_transfer_id: dto.reference,
        payout_attempts: (payment.payout_attempts ?? 0) + 1,
        payout_error: null,
        updated_at: now,
      })
      .eq('id', paymentId)
      .eq('status', 'released')
      .select()
      .single();

    if (error) throw new InternalServerErrorException(error.message);

    await this.logAudit({
      payment_id: paymentId,
      previous_status: 'released',
      new_status: 'disbursed',
      source: 'admin',
      changed_by: userId,
      note: dto.note ?? `Transferencia manual al técnico: ${dto.reference}`,
      metadata: { reference: dto.reference, method: dto.method ?? null },
    });

    const svc = await this.getServiceBasicData(disbursed.service_id);
    await this.notifyWorkerPaymentDeposited({
      workerId: disbursed.worker_id,
      paymentId,
      serviceId: disbursed.service_id,
      workerAmount: Number(disbursed.worker_amount),
      dataType: 'payment_disbursed',
      serviceTitle: svc?.title ?? null,
    });

    return {
      message: 'Transferencia registrada. El técnico fue notificado.',
      payment: disbursed,
    };
  }

  // ─── Reembolsar pago al cliente ─────────────────────────────────────────────

  async refundPayment(
    userId: string,
    paymentId: string,
    dto: RefundPaymentDto,
  ) {
    await this.requireAdmin(userId, 'Solo un administrador puede emitir reembolsos');

    const payment = await this.requirePayment(paymentId);

    if (payment.status !== 'held' && payment.status !== 'pending') {
      throw new BadRequestException(
        `Solo se puede reembolsar un pago en estado 'held' o 'pending'. Estado actual: ${payment.status}`,
      );
    }

    let refundReference: string | null = dto.manual_reference ?? null;

    if (payment.status === 'held' && !refundReference) {
      // Wompi solo permite anular pagos con tarjeta; Nequi, PSE, Bancolombia,
      // etc. se devuelven por transferencia y se registran con manual_reference.
      if (
        payment.provider_transaction_id &&
        payment.provider_payment_method === 'CARD'
      ) {
        try {
          await this.wompi.voidTransaction(payment.provider_transaction_id);
          refundReference = `VOID-${payment.provider_transaction_id}`;
        } catch (err) {
          this.logger.error(
            `Error anulando transacción Wompi ${payment.provider_transaction_id}: ${(err as Error).message}`,
          );
          throw new BadRequestException(
            'Wompi no permitió anular el pago. Devuelve el dinero por transferencia y registra el reembolso con manual_reference.',
          );
        }
      } else {
        throw new BadRequestException(
          'Este medio de pago no admite anulación automática. Devuelve el dinero al cliente por transferencia y registra el reembolso con manual_reference.',
        );
      }
    }

    const now = new Date().toISOString();
    const { data: refunded, error: refundErr } = await this.db
      .from('payments')
      .update({
        status: 'refunded',
        refunded_at: now,
        refund_reference: refundReference,
        updated_at: now,
      })
      .eq('id', paymentId)
      .select()
      .single();

    if (refundErr) throw new InternalServerErrorException(refundErr.message);

    await this.logAudit({
      payment_id: paymentId,
      previous_status: payment.status,
      new_status: 'refunded',
      source: 'admin',
      changed_by: userId,
      note: dto.reason ?? 'Reembolso emitido por administrador',
      metadata: {
        provider_transaction_id: payment.provider_transaction_id,
        refund_reference: refundReference,
      },
    });

    if (refunded.client_id && payment.status === 'held') {
      await this.pushService.sendToUser(refunded.client_id, {
        title: 'Reembolso procesado',
        body: `Tu pago de ${this.formatCop(refunded.amount_total)} ha sido reembolsado.`,
        data: { payment_id: paymentId, type: 'payment_refunded' },
      });
    }

    return { message: 'Pago reembolsado correctamente.', payment: refunded };
  }

  // ─── Historial de auditoría de un pago ─────────────────────────────────────

  async getAuditLogs(userId: string, paymentId: string) {
    const { data: payment, error } = await this.db
      .from('payments')
      .select('id, client_id, worker_id')
      .eq('id', paymentId)
      .maybeSingle();

    if (error) throw new InternalServerErrorException(error.message);
    if (!payment) throw new NotFoundException('Pago no encontrado');

    await this.requireParticipantOrAdmin(userId, payment);

    const { data: logs, error: logsErr } = await this.db
      .from('payment_audit_logs')
      .select('*')
      .eq('payment_id', paymentId)
      .order('created_at', { ascending: true });

    if (logsErr) throw new InternalServerErrorException(logsErr.message);
    return { logs: logs ?? [] };
  }

  // ─── Wallet completo del trabajador ────────────────────────────────────────

  async getWorkerWallet(workerId: string) {
    const { data: payments, error } = await this.db
      .from('payments')
      .select(
        `
        id, service_id, status, payout_status, payment_mode,
        worker_amount, commission_amount, amount_total, currency,
        created_at, paid_at, disbursed_at, external_transfer_id,
        services:service_id(title, scheduled_at, address)
      `,
      )
      .eq('worker_id', workerId)
      .order('created_at', { ascending: false });

    if (error) throw new InternalServerErrorException(error.message);

    const rows = payments ?? [];
    const sum = (filter: (p: (typeof rows)[number]) => boolean) =>
      rows.filter(filter).reduce((s, p) => s + Number(p.worker_amount ?? 0), 0);

    const transactions = rows.map((p) => ({
      id: p.id,
      service_id: p.service_id,
      service_title: (p.services as any)?.title ?? null,
      service_address: (p.services as any)?.address ?? null,
      scheduled_at: (p.services as any)?.scheduled_at ?? null,
      worker_amount: Number(p.worker_amount ?? 0),
      commission_amount: Number(p.commission_amount ?? 0),
      total_amount: Number(p.amount_total ?? 0),
      currency: p.currency ?? 'COP',
      status: p.status,
      payout_status: p.payout_status,
      payment_mode: p.payment_mode,
      external_transfer_id: p.external_transfer_id ?? null,
      created_at: p.created_at,
      paid_at: p.paid_at,
      disbursed_at: p.disbursed_at,
    }));

    return {
      // En custodia: el cliente pagó, el servicio aún no se confirma.
      processing_balance: sum((p) => p.status === 'held'),
      // Liberado y pendiente de que SerCom lo transfiera.
      available_balance: sum((p) => p.status === 'released'),
      pending_manual_total: sum((p) => p.status === 'released'),
      paid_out_total: sum((p) => p.status === 'disbursed'),
      marketplace_enabled: false,
      transactions,
    };
  }

  // ─── Balance del trabajador ─────────────────────────────────────────────────

  async getWorkerBalance(workerId: string) {
    const { data: payments, error } = await this.db
      .from('payments')
      .select('status, worker_amount')
      .eq('worker_id', workerId);

    if (error) throw new InternalServerErrorException(error.message);

    const rows = payments ?? [];
    const sum = (status: PaymentStatus) =>
      rows
        .filter((p) => p.status === status)
        .reduce((s, p) => s + Number(p.worker_amount ?? 0), 0);

    return {
      available: sum('released'),
      in_escrow: sum('held'),
      total_paid: sum('disbursed'),
    };
  }

  // ─── Aplicar estado de una transacción Wompi ────────────────────────────────

  /**
   * Idempotente: se puede llamar varias veces con la misma transacción
   * (webhook + polling del frontend). Solo avanza estados válidos.
   */
  private async applyTransaction(
    payment: any,
    tx: WompiTransaction,
    source: 'webhook' | 'system',
  ): Promise<any> {
    const current = payment.status as PaymentStatus;
    const now = new Date().toISOString();

    const isSameTx = payment.provider_transaction_id === tx.id;
    if (isSameTx && payment.provider_status === tx.status) {
      return payment;
    }

    if (tx.status === 'APPROVED') {
      const expectedCents = this.toCents(payment.amount_total);
      if (
        tx.amount_in_cents !== expectedCents ||
        (tx.currency ?? 'COP') !== (payment.currency ?? 'COP')
      ) {
        this.logger.error(
          `Transacción ${tx.id} aprobada con monto ${tx.amount_in_cents} ${tx.currency}, se esperaba ${expectedCents} ${payment.currency}`,
        );
        await this.logAudit({
          payment_id: payment.id,
          previous_status: current,
          new_status: current,
          source,
          note: `ALERTA: transacción Wompi ${tx.id} aprobada con monto distinto. Revisar y reembolsar.`,
          metadata: { transaction: tx },
        });
        return payment;
      }

      if (current !== 'pending' && current !== 'failed') {
        if (!isSameTx) {
          // Cobro duplicado (p. ej. el cliente pagó en dos pestañas).
          await this.logAudit({
            payment_id: payment.id,
            previous_status: current,
            new_status: current,
            source,
            note: `ALERTA: cobro duplicado, transacción Wompi ${tx.id} aprobada sobre un pago ya ${current}. Reembolsar al cliente.`,
            metadata: { transaction: tx },
          });
        }
        return payment;
      }

      const { data: held, error } = await this.db
        .from('payments')
        .update({
          status: 'held',
          paid_at: tx.finalized_at ?? now,
          receipt_number: this.receiptNumberFor(payment.id),
          provider: 'wompi',
          provider_reference: tx.id,
          provider_transaction_id: tx.id,
          provider_status: tx.status,
          provider_status_detail: tx.status_message ?? null,
          provider_payment_method: tx.payment_method_type ?? null,
          updated_at: now,
        })
        .eq('id', payment.id)
        .in('status', ['pending', 'failed'])
        .select()
        .maybeSingle();

      if (error) {
        this.logger.error(
          `Error marcando pago ${payment.id} como held: ${error.message}`,
        );
        throw new InternalServerErrorException(error.message);
      }
      if (!held) return payment; // otro proceso ya lo actualizó

      await this.logAudit({
        payment_id: payment.id,
        previous_status: current,
        new_status: 'held',
        source,
        note: `Wompi APPROVED (${tx.payment_method_type ?? 'N/A'})`,
        metadata: { transaction_id: tx.id, reference: tx.reference },
      });

      await this.notifyPaymentHeld(held);
      return held;
    }

    // PENDING / DECLINED / ERROR / VOIDED
    if (current !== 'pending') {
      // Un pago ya resuelto no retrocede por un intento posterior/anterior.
      return payment;
    }

    const becomesFailed =
      tx.status === 'DECLINED' || tx.status === 'ERROR' || tx.status === 'VOIDED';

    const { data: updated, error } = await this.db
      .from('payments')
      .update({
        ...(becomesFailed ? { status: 'failed' } : {}),
        provider_transaction_id: tx.id,
        provider_status: tx.status,
        provider_status_detail: tx.status_message ?? null,
        provider_payment_method: tx.payment_method_type ?? null,
        updated_at: now,
      })
      .eq('id', payment.id)
      .eq('status', 'pending')
      .select()
      .maybeSingle();

    if (error) {
      this.logger.error(
        `Error actualizando pago ${payment.id} (${tx.status}): ${error.message}`,
      );
      throw new InternalServerErrorException(error.message);
    }

    if (becomesFailed) {
      await this.logAudit({
        payment_id: payment.id,
        previous_status: 'pending',
        new_status: 'failed',
        source,
        note: `Wompi ${tx.status}: ${tx.status_message ?? ''}`.trim(),
        metadata: { transaction_id: tx.id, reference: tx.reference },
      });
    }

    return updated ?? payment;
  }

  /** Consulta a Wompi el último intento de un pago pendiente. Nunca lanza. */
  private async syncWithProvider(payment: any): Promise<any> {
    if (
      payment.status !== 'pending' ||
      !payment.checkout_reference ||
      !this.wompi.isConfigured
    ) {
      return payment;
    }

    try {
      const transactions = await this.wompi.findTransactionsByReference(
        payment.checkout_reference,
      );
      if (!transactions.length) return payment;

      const tx =
        transactions.find((t) => t.status === 'APPROVED') ??
        transactions.find((t) => t.status === 'PENDING') ??
        transactions[0];

      return await this.applyTransaction(payment, tx, 'system');
    } catch (err) {
      this.logger.warn(
        `No se pudo sincronizar pago ${payment.id} con Wompi: ${(err as Error).message}`,
      );
      return payment;
    }
  }

  private async markReleased(
    payment: any,
    opts: { source: 'admin' | 'system'; changedBy?: string; note?: string },
  ) {
    const now = new Date().toISOString();
    const { data: released, error } = await this.db
      .from('payments')
      .update({
        status: 'released',
        released_at: now,
        payout_status: 'pending_manual',
        updated_at: now,
      })
      .eq('id', payment.id)
      .eq('status', 'held')
      .select()
      .maybeSingle();

    if (error) throw new InternalServerErrorException(error.message);
    if (!released) {
      throw new BadRequestException('El pago ya no está en custodia');
    }

    await this.logAudit({
      payment_id: payment.id,
      previous_status: 'held',
      new_status: 'released',
      source: opts.source,
      changed_by: opts.changedBy ?? null,
      note:
        opts.note ??
        'Custodia liberada. Pendiente transferencia manual al técnico.',
    });

    const svc = await this.getServiceBasicData(released.service_id);
    const label = svc?.title?.trim() || 'tu servicio';

    if (released.worker_id) {
      await this.pushService.sendToUser(released.worker_id, {
        title: 'Pago liberado',
        body: `Liberamos ${this.formatCop(released.worker_amount)} por «${label}». SerCom te lo transferirá en un plazo máximo de 2 días hábiles.`,
        data: {
          type: 'payment_released',
          payment_id: String(released.id),
          service_id: String(released.service_id),
        },
      });
    }

    if (released.client_id) {
      await this.pushService.sendToUser(released.client_id, {
        title: 'Servicio finalizado',
        body: 'El pago fue liberado al técnico. ¡Gracias por usar SerCom!',
        data: { payment_id: released.id, type: 'service_completed' },
      });
    }

    return released;
  }

  // ─── Helpers privados ───────────────────────────────────────────────────────

  private paymentIdFromReference(reference: string | undefined) {
    const id = reference?.split('_')[0] ?? '';
    return /^[0-9a-f-]{36}$/i.test(id) ? id : null;
  }

  private toCents(amount: number | string) {
    return Math.round(Number(amount) * 100);
  }

  private formatCop(amount: number | string) {
    return `$${Number(amount).toLocaleString('es-CO')} COP`;
  }

  private receiptNumberFor(paymentId: string) {
    return `SC-${paymentId.replace(/-/g, '').slice(0, 12).toUpperCase()}`;
  }

  private hasReceipt(payment: any) {
    return ['held', 'released', 'disbursed'].includes(payment.status);
  }

  private async requirePayment(paymentId: string) {
    const { data: payment, error } = await this.db
      .from('payments')
      .select('*')
      .eq('id', paymentId)
      .maybeSingle();

    if (error) throw new InternalServerErrorException(error.message);
    if (!payment) throw new NotFoundException('Pago no encontrado');
    return payment;
  }

  private async requireServiceForClient(serviceId: string, clientId: string) {
    const { data: service, error } = await this.db
      .from('services')
      .select('id, client_id, assigned_worker_id, status, title, description')
      .eq('id', serviceId)
      .maybeSingle();

    if (error) throw new InternalServerErrorException(error.message);
    if (!service) throw new NotFoundException('Servicio no encontrado');
    if (service.client_id !== clientId) {
      throw new ForbiddenException(
        'No puedes pagar un servicio que no te pertenece',
      );
    }
    if (service.status !== 'assigned') {
      throw new BadRequestException(
        'Solo puedes iniciar el pago de un servicio con técnico asignado',
      );
    }
    return service;
  }

  private async requirePendingPayment(serviceId: string, clientId: string) {
    const { data: payment, error } = await this.db
      .from('payments')
      .select('*')
      .eq('service_id', serviceId)
      .eq('client_id', clientId)
      .maybeSingle();

    if (error) throw new InternalServerErrorException(error.message);
    if (!payment) {
      throw new NotFoundException(
        'No existe un pago para este servicio. Primero debes aceptar una propuesta.',
      );
    }
    return payment;
  }

  private guardFinalStatus(status: PaymentStatus) {
    if (status === 'released') {
      throw new BadRequestException('Este pago ya fue liberado');
    }
    if (status === 'refunded') {
      throw new BadRequestException('Este pago ya fue reembolsado');
    }
    if (status === 'disbursed') {
      throw new BadRequestException('Este pago ya fue desembolsado al técnico');
    }
  }

  private async requireParticipantOrAdmin(
    userId: string,
    payment: { client_id: string; worker_id?: string | null },
  ) {
    const isParticipant =
      payment.client_id === userId || payment.worker_id === userId;
    if (!isParticipant && !(await this.isAdmin(userId))) {
      throw new ForbiddenException('No tienes permiso para ver este pago');
    }
  }

  private async requireAdmin(userId: string, message: string) {
    if (!(await this.isAdmin(userId))) {
      throw new ForbiddenException(message);
    }
  }

  private async isAdmin(userId: string): Promise<boolean> {
    const { data } = await this.db
      .from('profiles')
      .select('roles, active_role')
      .eq('id', userId)
      .maybeSingle();

    if (!data) return false;
    const roles: string[] = Array.isArray(data.roles) ? data.roles : [];
    return roles.includes('admin') || data.active_role === 'admin';
  }

  private async getServiceBasicData(serviceId: string) {
    const { data } = await this.db
      .from('services')
      .select('id, title, description, address, scheduled_at')
      .eq('id', serviceId)
      .maybeSingle();
    return data;
  }

  private buildReceipt(payment: any, service: any) {
    return {
      receipt_number:
        payment.receipt_number ?? this.receiptNumberFor(payment.id),
      payment_id: payment.id,
      service_id: payment.service_id,
      service_title: service?.title ?? null,
      service_address: service?.address ?? null,
      scheduled_at: service?.scheduled_at ?? null,
      amount_total: payment.amount_total,
      commission_amount: payment.commission_amount,
      worker_amount: payment.worker_amount,
      currency: payment.currency,
      provider: payment.provider,
      provider_reference: payment.provider_reference,
      payment_method: payment.provider_payment_method ?? payment.payment_method,
      status: payment.status,
      paid_at: payment.paid_at,
      released_at: payment.released_at ?? null,
      custodied_by: 'SerCom',
      message:
        payment.status === 'held'
          ? 'Pago retenido bajo custodia segura de la plataforma'
          : 'Pago liberado al técnico',
    };
  }

  private buildCheckoutResponse(payment: any, checkoutUrl: string) {
    return {
      message:
        'Link de pago generado. Completa el pago para garantizar la reserva.',
      payment,
      payment_id: payment.id,
      checkout_url: checkoutUrl,
      sandbox: this.wompi.isSandbox,
      instructions:
        'Puedes pagar con Nequi, Bancolombia, PSE o tarjeta. El dinero quedará retenido por SerCom hasta que confirmes el servicio.',
    };
  }

  private async notifyPaymentHeld(payment: any) {
    if (payment.worker_id) {
      await this.pushService.sendToUser(payment.worker_id, {
        title: 'Pago garantizado',
        body: 'El cliente garantizó el pago. Puedes iniciar el servicio.',
        data: { type: 'payment_guaranteed', payment_id: String(payment.id) },
      });
    }
    if (payment.client_id) {
      await this.pushService.sendToUser(payment.client_id, {
        title: 'Pago recibido',
        body: 'Tu pago fue procesado y queda bajo custodia de la plataforma.',
        data: { payment_id: payment.id, type: 'payment_held' },
      });
    }
  }

  /**
   * HU26 — Notificación al trabajador cuando el pago queda depositado:
   * incluye monto y nombre del servicio (push + data para deep link).
   */
  private async notifyWorkerPaymentDeposited(params: {
    workerId: string | null | undefined;
    paymentId: string;
    serviceId: string;
    workerAmount: number;
    dataType: 'payment_released' | 'payment_disbursed';
    serviceTitle?: string | null;
  }): Promise<void> {
    if (!params.workerId) return;

    let title =
      params.serviceTitle?.trim() ||
      (await this.getServiceBasicData(params.serviceId))?.title?.trim() ||
      'Tu servicio';
    if (title.length > 120) {
      title = `${title.slice(0, 117)}…`;
    }

    await this.pushService.sendToUser(params.workerId, {
      title: 'Pago depositado',
      body: `Te transferimos ${this.formatCop(params.workerAmount)} por el servicio «${title}».`,
      data: {
        type: params.dataType,
        payment_id: String(params.paymentId),
        service_id: String(params.serviceId),
        service_title: title,
      },
    });
  }

  private async logAudit(params: {
    payment_id: string;
    previous_status?: string;
    new_status: string;
    source: 'admin' | 'webhook' | 'system' | 'client';
    changed_by?: string | null;
    note?: string;
    metadata?: Record<string, any>;
  }) {
    const { error } = await this.db.from('payment_audit_logs').insert({
      payment_id: params.payment_id,
      previous_status: params.previous_status ?? null,
      new_status: params.new_status,
      source: params.source,
      changed_by: params.changed_by ?? null,
      note: params.note ?? null,
      metadata: params.metadata ?? null,
    });

    if (error) {
      this.logger.error(`Error registrando audit log: ${error.message}`);
    }
  }
}
