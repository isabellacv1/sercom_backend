import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  InternalServerErrorException,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import MercadoPagoConfig, {
  Payment as MpPayment,
  Preference,
  WebhookSignatureValidator,
} from 'mercadopago';
import { SupabaseService } from '../supabase/supabase.service';
import { PushNotificationsService } from '../push-notifications/push-notifications.service';
import { PayoutService } from './payout.service';
import { MpOAuthService } from '../oauth/mp-oauth.service';
import { CreateMercadoPagoLinkDto } from './dto/create-mercadopago-link.dto';
import { ConfirmMercadoPagoPaymentDto } from './dto/confirm-mercadopago-payment.dto';
import { ReleasePaymentDto } from './dto/release-payment.dto';
import { RefundPaymentDto } from './dto/refund-payment.dto';

type PaymentStatus =
  | 'pending'
  | 'held'
  | 'released'
  | 'refunded'
  | 'failed'
  | 'disbursed';

@Injectable()
export class PaymentsService {
  private readonly logger = new Logger(PaymentsService.name);
  private readonly mpClient: MercadoPagoConfig;
  private readonly webhookSecret: string | undefined;
  private readonly appUrl: string;
  private readonly frontendUrl: string;

  constructor(
    private readonly supabaseService: SupabaseService,
    private readonly configService: ConfigService,
    private readonly pushService: PushNotificationsService,
    private readonly payoutService: PayoutService,
    private readonly mpOAuthService: MpOAuthService,
  ) {
    const accessToken = this.configService.get<string>('MP_ACCESS_TOKEN') ?? '';
    this.webhookSecret = this.configService.get<string>('MP_WEBHOOK_SECRET');
    this.appUrl = this.configService.get<string>('APP_URL') ?? '';
    this.frontendUrl =
      this.configService.get<string>('MP_FRONTEND_URL') ?? this.appUrl;

    if (!accessToken) {
      this.logger.error(
        'MP_ACCESS_TOKEN no configurado. Los pagos no funcionarán.',
      );
    }

    this.mpClient = new MercadoPagoConfig({ accessToken });
  }

  private get db() {
    return this.supabaseService.sbRaw;
  }

  // ─── Crear Checkout Pro (Preference) ────────────────────────────────────────

  async createCheckoutPreference(
    clientId: string,
    dto: CreateMercadoPagoLinkDto,
  ) {
    const service = await this.requireServiceForClient(
      dto.service_id,
      clientId,
    );

    if (!service.assigned_worker_id) {
      throw new BadRequestException('El servicio no tiene técnico asignado');
    }

    const payment = await this.requirePendingPayment(service.id, clientId);

    if (payment.status === 'held') {
      const svc = await this.getServiceBasicData(service.id);
      return {
        message: 'El pago ya fue aprobado y está retenido por la plataforma',
        payment,
        receipt: this.buildReceipt(payment, svc),
      };
    }

    this.guardFinalStatus(payment.status as PaymentStatus);

    // Reutilizar preference existente si la URL guardada es válida (no sandbox)
    if (
      payment.mp_preference_id &&
      payment.checkout_url &&
      !payment.checkout_url.includes('sandbox')
    ) {
      return this.buildCheckoutResponse(payment, payment.checkout_url);
    }

    const { data: clientProfile } = await this.db
      .from('profiles')
      .select('full_name, email')
      .eq('id', clientId)
      .maybeSingle();

    this.logger.log(
      JSON.stringify(
        {
          payer: {
            name: clientProfile?.full_name,
            email: clientProfile?.email,
          },
        },
        null,
        2,
      ),
    );

    // Verificar si el trabajador tiene OAuth conectado para usar Marketplace Split
    const workerAccount = await this.mpOAuthService.getWorkerAccount(
      service.assigned_worker_id,
    );
    const useMarketplaceSplit = !!workerAccount;

    let preferenceResult: any;

    try {
      if (useMarketplaceSplit) {
        // ── Marketplace Split: usar el token del trabajador ────────────────
        // El pago se divide automáticamente:
        //   worker recibe: amount_total - commission_amount
        //   SerCom recibe: commission_amount (marketplace_fee)
        // Requiere que la app esté registrada como Marketplace en MP.
        const workerMpClient = new MercadoPagoConfig({
          accessToken: workerAccount.mp_access_token,
        });
        const workerPreferenceAPI = new Preference(workerMpClient);

        preferenceResult = await workerPreferenceAPI.create({
          body: {
            external_reference: payment.id,
            // marketplace_fee: Number(payment.commission_amount),
            items: [
              {
                id: service.id,
                title: service.title ?? 'Servicio técnico',
                description: service.description ?? '',
                quantity: 1,
                unit_price: Number(payment.amount_total),
                currency_id: 'COP',
              },
            ],
            payer: {
              name: clientProfile?.full_name ?? '',
              email: clientProfile?.email ?? '',
            },
            notification_url: `${this.appUrl}/payments/webhook/mercadopago`,
            back_urls: {
              success: `${this.frontendUrl}/payment/success`,
              failure: `${this.frontendUrl}/payment/failure`,
              pending: `${this.frontendUrl}/payment/pending`,
            },
            auto_return: 'approved',
            statement_descriptor: 'SerCom',
            expires: true,
            expiration_date_from: new Date().toISOString(),
            expiration_date_to: new Date(
              Date.now() + 48 * 60 * 60 * 1000,
            ).toISOString(),
          },
        });

        this.logger.log(
          `Marketplace split activado para pago ${payment.id}. Worker MP: ${workerAccount.mp_user_id}`,
        );
      } else {
        // ── Flujo estándar: todo entra a cuenta SerCom, payout manual después ─
        const preferenceAPI = new Preference(this.mpClient);
        preferenceResult = await preferenceAPI.create({
          body: {
            external_reference: payment.id,
            items: [
              {
                id: service.id,
                title: service.title ?? 'Servicio técnico',
                description: service.description ?? '',
                quantity: 1,
                unit_price: Number(payment.amount_total),
                currency_id: 'COP',
              },
            ],
            payer: { name: clientProfile?.full_name ?? '' },
            notification_url: `${this.appUrl}/payments/webhook/mercadopago`,
            back_urls: {
              success: `${this.frontendUrl}/payment/success`,
              failure: `${this.frontendUrl}/payment/failure`,
              pending: `${this.frontendUrl}/payment/pending`,
            },
            auto_return: 'approved',
            statement_descriptor: 'SerCom',
            expires: true,
            expiration_date_from: new Date().toISOString(),
            expiration_date_to: new Date(
              Date.now() + 48 * 60 * 60 * 1000,
            ).toISOString(),
          },
        });
      }
    } catch (err) {
      this.logger.error(
        `Error creando preference MP: ${(err as Error).message}`,
      );
      throw new InternalServerErrorException(
        'No se pudo generar el link de pago. Intenta nuevamente.',
      );
    }

    const checkoutUrl: string = preferenceResult.init_point;

    const { data: updated, error: updateError } = await this.db
      .from('payments')
      .update({
        mp_preference_id: preferenceResult.id,
        checkout_url: checkoutUrl,
        provider: 'mercadopago',
        payment_method: dto.payment_method ?? 'mercadopago_checkout',
        payment_mode: useMarketplaceSplit ? 'marketplace' : 'platform',
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
      note: `Preference MP creada: ${preferenceResult.id}`,
      metadata: { mp_preference_id: preferenceResult.id },
    });

    return this.buildCheckoutResponse(updated, checkoutUrl);
  }

  // ─── Consultar pago por servicio ────────────────────────────────────────────

  async findByService(userId: string, serviceId: string) {
    const { data: payment, error } = await this.db
      .from('payments')
      .select('*')
      .eq('service_id', serviceId)
      .maybeSingle();

    if (error) throw new InternalServerErrorException(error.message);
    if (!payment) throw new NotFoundException('Pago no encontrado');

    await this.requireParticipantOrAdmin(userId, payment);

    const service = await this.getServiceBasicData(serviceId);
    return {
      payment,
      receipt:
        payment.status === 'held' || payment.status === 'released'
          ? this.buildReceipt(payment, service)
          : null,
    };
  }

  // ─── Consultar pago por ID ──────────────────────────────────────────────────

  async findById(userId: string, paymentId: string) {
    const { data: payment, error } = await this.db
      .from('payments')
      .select('*')
      .eq('id', paymentId)
      .maybeSingle();

    if (error) throw new InternalServerErrorException(error.message);
    if (!payment) throw new NotFoundException('Pago no encontrado');

    await this.requireParticipantOrAdmin(userId, payment);

    const service = await this.getServiceBasicData(payment.service_id);
    return {
      payment,
      receipt:
        payment.status === 'held' || payment.status === 'released'
          ? this.buildReceipt(payment, service)
          : null,
    };
  }

  // ─── Obtener comprobante digital ────────────────────────────────────────────

  async getReceipt(userId: string, paymentId: string) {
    const { data: payment, error } = await this.db
      .from('payments')
      .select('*')
      .eq('id', paymentId)
      .maybeSingle();

    if (error) throw new InternalServerErrorException(error.message);
    if (!payment) throw new NotFoundException('Pago no encontrado');

    await this.requireParticipantOrAdmin(userId, payment);

    if (payment.status !== 'held' && payment.status !== 'released') {
      throw new BadRequestException(
        'El comprobante solo está disponible para pagos aprobados o liberados',
      );
    }

    const service = await this.getServiceBasicData(payment.service_id);
    return { receipt: this.buildReceipt(payment, service) };
  }

  // ─── Confirmación manual por admin ──────────────────────────────────────────

  async confirmMercadoPagoPayment(
    userId: string,
    paymentId: string,
    dto: ConfirmMercadoPagoPaymentDto,
  ) {
    if (!(await this.isAdmin(userId))) {
      throw new ForbiddenException(
        'Solo un administrador puede confirmar pagos manualmente',
      );
    }

    const { data: payment, error } = await this.db
      .from('payments')
      .select('*')
      .eq('id', paymentId)
      .maybeSingle();

    if (error) throw new InternalServerErrorException(error.message);
    if (!payment) throw new NotFoundException('Pago no encontrado');

    const status = payment.status as PaymentStatus;
    if (status === 'held') {
      throw new BadRequestException(
        'Este pago ya fue confirmado anteriormente',
      );
    }
    if (status === 'failed') {
      throw new BadRequestException(
        'Este pago fue rechazado. Solicita un nuevo pago al cliente.',
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

    const receiptNumber = `MP-${paymentId}`;
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

    await this.notifyWorkerPaymentGuaranteed(held.worker_id);

    if (held.client_id) {
      await this.pushService.sendToUser(held.client_id, {
        title: 'Pago recibido',
        body: 'Tu pago fue procesado y queda bajo custodia de la plataforma.',
        data: { payment_id: paymentId, type: 'payment_held' },
      });
    }

    const service = await this.getServiceBasicData(held.service_id);
    return {
      message:
        'Pago aprobado. El dinero queda retenido bajo custodia de la plataforma.',
      payment: held,
      receipt: this.buildReceipt(held, service),
    };
  }

  // ─── Webhook automático de Mercado Pago ─────────────────────────────────────

  async handleWebhook(
    xSignature: string | undefined,
    xRequestId: string | undefined,
    query: Record<string, string>,
    body: any,
  ) {
    if (this.webhookSecret) {
      WebhookSignatureValidator.validate({
        xSignature: xSignature ?? '',
        xRequestId: xRequestId ?? '',
        dataId: query['data.id'] ?? body?.data?.id ?? '',
        secret: this.webhookSecret,
        toleranceSeconds: 300,
      });
    }

    if (body?.type !== 'payment' && body?.action !== 'payment.updated') {
      return { received: true };
    }

    const mpPaymentId: string | undefined =
      query['data.id'] ?? body?.data?.id?.toString();

    if (!mpPaymentId) {
      this.logger.warn('Webhook MP recibido sin data.id');
      return { received: true };
    }

    let mpPaymentData: any;
    try {
      const paymentAPI = new MpPayment(this.mpClient);
      mpPaymentData = await paymentAPI.get({ id: mpPaymentId });
    } catch (err) {
      this.logger.error(
        `Error consultando pago MP ${mpPaymentId}: ${(err as Error).message}`,
      );
      return { received: true };
    }

    const externalRef: string | undefined = mpPaymentData?.external_reference;
    if (!externalRef) {
      this.logger.warn(`Pago MP ${mpPaymentId} sin external_reference`);
      return { received: true };
    }

    const { data: payment, error: findErr } = await this.db
      .from('payments')
      .select('*')
      .eq('id', externalRef)
      .maybeSingle();

    if (findErr || !payment) {
      this.logger.warn(
        `Pago MP ${mpPaymentId} con external_reference=${externalRef} no encontrado`,
      );
      return { received: true };
    }

    // Idempotencia: no reprocesar el mismo evento
    if (payment.mp_payment_id === mpPaymentId) {
      return { received: true };
    }

    await this.processMpPaymentStatus(payment, mpPaymentData);
    return { received: true };
  }

  // ─── Liberar fondos al técnico (post-servicio completado) ───────────────────

  async releasePayment(
    userId: string,
    paymentId: string,
    dto: ReleasePaymentDto,
  ) {
    if (!(await this.isAdmin(userId))) {
      throw new ForbiddenException(
        'Solo un administrador puede liberar fondos',
      );
    }

    const { data: payment, error } = await this.db
      .from('payments')
      .select('*')
      .eq('id', paymentId)
      .maybeSingle();

    if (error) throw new InternalServerErrorException(error.message);
    if (!payment) throw new NotFoundException('Pago no encontrado');

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

    const now = new Date().toISOString();
    const { data: released, error: releaseErr } = await this.db
      .from('payments')
      .update({ status: 'released', released_at: now, updated_at: now })
      .eq('id', paymentId)
      .select()
      .single();

    if (releaseErr) throw new InternalServerErrorException(releaseErr.message);

    await this.logAudit({
      payment_id: paymentId,
      previous_status: 'held',
      new_status: 'released',
      source: 'admin',
      changed_by: userId,
      note:
        dto.note ?? 'Fondos liberados al técnico tras completar el servicio',
    });

    if (released.worker_id) {
      await this.pushService.sendToUser(released.worker_id, {
        title: 'Pago liberado',
        body: `Se liberaron $${Number(released.worker_amount).toLocaleString('es-CO')} COP a tu cuenta.`,
        data: { payment_id: paymentId, type: 'payment_released' },
      });
    }

    if (released.client_id) {
      await this.pushService.sendToUser(released.client_id, {
        title: 'Servicio finalizado',
        body: 'El pago fue liberado al técnico. ¡Gracias por usar SerCom!',
        data: { payment_id: paymentId, type: 'payment_released' },
      });
    }

    const svc = await this.getServiceBasicData(released.service_id);
    return {
      message: 'Fondos liberados al técnico correctamente.',
      payment: released,
      receipt: this.buildReceipt(released, svc),
    };
  }

  // ─── Reembolsar pago al cliente ─────────────────────────────────────────────

  async refundPayment(
    userId: string,
    paymentId: string,
    dto: RefundPaymentDto,
  ) {
    if (!(await this.isAdmin(userId))) {
      throw new ForbiddenException(
        'Solo un administrador puede emitir reembolsos',
      );
    }

    const { data: payment, error } = await this.db
      .from('payments')
      .select('*')
      .eq('id', paymentId)
      .maybeSingle();

    if (error) throw new InternalServerErrorException(error.message);
    if (!payment) throw new NotFoundException('Pago no encontrado');

    if (payment.status !== 'held' && payment.status !== 'pending') {
      throw new BadRequestException(
        `Solo se puede reembolsar un pago en estado 'held' o 'pending'. Estado actual: ${payment.status}`,
      );
    }

    if (payment.mp_payment_id) {
      try {
        const { PaymentRefund } = await import('mercadopago');
        const refundAPI = new PaymentRefund(this.mpClient);
        await refundAPI.create({ payment_id: payment.mp_payment_id, body: {} });
      } catch (err) {
        this.logger.error(
          `Error al reembolsar en MP payment_id=${payment.mp_payment_id}: ${(err as Error).message}`,
        );
      }
    }

    const now = new Date().toISOString();
    const { data: refunded, error: refundErr } = await this.db
      .from('payments')
      .update({ status: 'refunded', refunded_at: now, updated_at: now })
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
      metadata: { mp_payment_id: payment.mp_payment_id },
    });

    if (refunded.client_id) {
      await this.pushService.sendToUser(refunded.client_id, {
        title: 'Reembolso procesado',
        body: `Tu pago de $${Number(refunded.amount_total).toLocaleString('es-CO')} COP ha sido reembolsado.`,
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

  // ─── Procesar estado MP y actualizar DB ─────────────────────────────────────

  private async processMpPaymentStatus(payment: any, mpData: any) {
    const mpStatus: string = mpData.status ?? '';
    const mpStatusDetail: string = mpData.status_detail ?? '';
    const mpPaymentId: string = mpData.id?.toString() ?? '';
    const now = new Date().toISOString();

    let newStatus: PaymentStatus | null = null;

    if (mpStatus === 'approved') {
      newStatus = 'held';
    } else if (
      mpStatus === 'rejected' ||
      mpStatus === 'cancelled' ||
      mpStatus === 'charged_back'
    ) {
      newStatus = 'failed';
    } else {
      // pending / in_process / authorized — actualizar metadatos sin cambiar status
      await this.db
        .from('payments')
        .update({
          mp_payment_id: mpPaymentId,
          mp_status: mpStatus,
          mp_status_detail: mpStatusDetail,
          updated_at: now,
        })
        .eq('id', payment.id);
      return;
    }

    if (newStatus === payment.status) return;

    const updatePayload: Record<string, any> = {
      status: newStatus,
      mp_payment_id: mpPaymentId,
      mp_status: mpStatus,
      mp_status_detail: mpStatusDetail,
      provider_reference: mpPaymentId,
      updated_at: now,
    };

    if (newStatus === 'held') {
      updatePayload.paid_at = now;
      updatePayload.receipt_number = `MP-${payment.id}`;
    }

    const { error } = await this.db
      .from('payments')
      .update(updatePayload)
      .eq('id', payment.id);

    if (error) {
      this.logger.error(
        `Error actualizando pago ${payment.id} desde webhook: ${error.message}`,
      );
      return;
    }

    await this.logAudit({
      payment_id: payment.id,
      previous_status: payment.status,
      new_status: newStatus,
      source: 'webhook',
      mp_payment_id: mpPaymentId,
      note: `Webhook MP: ${mpStatus} / ${mpStatusDetail}`,
      metadata: { mp_status: mpStatus, mp_status_detail: mpStatusDetail },
    });

    if (newStatus === 'held') {
      await this.notifyWorkerPaymentGuaranteed(payment.worker_id);
      if (payment.client_id) {
        await this.pushService.sendToUser(payment.client_id, {
          title: 'Pago recibido',
          body: 'Tu pago fue procesado y queda bajo custodia de la plataforma.',
          data: { payment_id: payment.id, type: 'payment_held' },
        });
      }
    }
  }

  // ─── Helpers privados ───────────────────────────────────────────────────────

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

    const processingBalance = rows
      .filter((p) => p.status === 'held')
      .reduce((s, p) => s + Number(p.worker_amount ?? 0), 0);

    const availableBalance = rows
      .filter((p) => p.status === 'released' || p.status === 'disbursed')
      .reduce((s, p) => s + Number(p.worker_amount ?? 0), 0);

    const paidOutTotal = rows
      .filter(
        (p) => p.status === 'disbursed' && p.payout_status === 'completed',
      )
      .reduce((s, p) => s + Number(p.worker_amount ?? 0), 0);

    const pendingManualTotal = rows
      .filter((p) => p.payout_status === 'pending_manual')
      .reduce((s, p) => s + Number(p.worker_amount ?? 0), 0);

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

    const mpConnected =
      !!(await this.mpOAuthService.getWorkerAccount(workerId));

    return {
      available_balance: availableBalance,
      processing_balance: processingBalance,
      paid_out_total: paidOutTotal,
      pending_manual_total: pendingManualTotal,
      marketplace_enabled: mpConnected,
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

    const inEscrow = rows
      .filter((p) => p.status === 'held')
      .reduce((sum, p) => sum + Number(p.worker_amount ?? 0), 0);

    const available = rows
      .filter((p) => p.status === 'released' || p.status === 'disbursed')
      .reduce((sum, p) => sum + Number(p.worker_amount ?? 0), 0);

    const totalPaid = rows
      .filter((p) => p.status === 'disbursed')
      .reduce((sum, p) => sum + Number(p.worker_amount ?? 0), 0);

    return { available, in_escrow: inEscrow, total_paid: totalPaid };
  }

  // ─── Desembolso automático al técnico ───────────────────────────────────────

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

    // Idempotencia: ya fue procesado
    if (
      payment.payout_status === 'completed' ||
      payment.status === 'disbursed'
    ) {
      return;
    }

    // Si fue un pago marketplace, el trabajador ya recibió su dinero al momento del pago.
    // Solo actualizamos el estado interno.
    if (payment.payment_mode === 'marketplace') {
      const result = this.payoutService.marketplaceSplitAlreadyExecuted(
        payment.id,
      );
      const now = new Date().toISOString();
      await this.db
        .from('payments')
        .update({
          status: 'disbursed',
          payout_status: 'completed',
          disbursed_at: now,
          payout_attempts: 1,
          updated_at: now,
        })
        .eq('id', payment.id);

      await this.logAudit({
        payment_id: payment.id,
        previous_status: 'held',
        new_status: 'disbursed',
        source: 'system',
        note: 'Marketplace split: el trabajador recibió su pago automáticamente.',
        metadata: { method: result.method },
      });
      if (payment.worker_id) {
        await this.pushService.sendToUser(payment.worker_id, {
          title: '¡Misión completada!',
          body: `Tu pago de $${Number(payment.worker_amount).toLocaleString('es-CO')} COP ya está en tu cuenta Mercado Pago.`,
          data: { payment_id: payment.id, type: 'payment_disbursed' },
        });
      }
      return;
    }

    // Flujo estándar: plataforma transfiere al trabajador
    const workerAccount = await this.mpOAuthService.getWorkerAccount(
      payment.worker_id,
    );

    const result = await this.payoutService.transferToWorker({
      referenceId: payment.id,
      recipientMpUserId: workerAccount?.mp_user_id ?? '',
      amount: Number(payment.worker_amount),
      description: `SerCom - Servicio completado ${serviceId}`,
    });

    const now = new Date().toISOString();
    const updatePayload: Record<string, any> = {
      payout_status: result.payoutStatus,
      payout_attempts: (payment.payout_attempts ?? 0) + 1,
      updated_at: now,
    };

    // El pago se compromete al trabajador aunque la transferencia sea manual.
    // Esto garantiza que el trabajador siempre ve el dinero como "disponible".
    if (result.success || result.payoutStatus === 'pending_manual') {
      updatePayload.status = 'disbursed';
      updatePayload.disbursed_at = now;
      if (result.externalId) {
        updatePayload.external_transfer_id = result.externalId;
      }
      if (result.error) {
        updatePayload.payout_error = result.error;
      }
    } else {
      updatePayload.payout_error = result.error;
    }

    await this.db.from('payments').update(updatePayload).eq('id', payment.id);

    await this.logAudit({
      payment_id: payment.id,
      previous_status: 'held',
      new_status: updatePayload.status ?? 'held',
      source: 'system',
      note: result.success
        ? `Payout automático ejecutado. MP transfer ID: ${result.externalId}`
        : `Payout ${result.payoutStatus}: ${result.error}`,
      metadata: { payout_result: result },
    });

    if (payment.worker_id) {
      const workerAmount = Number(payment.worker_amount).toLocaleString(
        'es-CO',
      );
      await this.pushService.sendToUser(payment.worker_id, {
        title: result.success ? '¡Pago recibido!' : 'Pago en proceso',
        body: result.success
          ? `Se transfirieron $${workerAmount} COP a tu cuenta.`
          : `Tu pago de $${workerAmount} COP está siendo procesado.`,
        data: { payment_id: payment.id, type: 'payment_disbursed' },
      });
    }

    if (payment.client_id) {
      await this.pushService.sendToUser(payment.client_id, {
        title: 'Servicio finalizado',
        body: 'El pago fue liberado al técnico. ¡Gracias por usar SerCom!',
        data: { payment_id: payment.id, type: 'service_completed' },
      });
    }
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
      receipt_number: payment.receipt_number ?? `PAY-${payment.id}`,
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
      payment_method: payment.payment_method,
      status: payment.status,
      paid_at: payment.paid_at,
      released_at: payment.released_at ?? null,
      custodied_by: 'SerCom',
      message:
        payment.status === 'released'
          ? 'Pago liberado al técnico'
          : 'Pago retenido bajo custodia segura de la plataforma',
    };
  }

  private buildCheckoutResponse(payment: any, checkoutUrl: string) {
    return {
      message:
        'Link de pago generado. Completa el pago para garantizar la reserva.',
      payment,
      checkout_url: checkoutUrl,
      instructions:
        'Después de pagar, el dinero quedará retenido por la plataforma. El técnico recibirá una notificación para iniciar el servicio.',
    };
  }

  private async notifyWorkerPaymentGuaranteed(workerId: string | null) {
    if (!workerId) return;
    await this.pushService.sendToUser(workerId, {
      title: 'Pago garantizado',
      body: 'El cliente garantizó el pago. Puedes iniciar el servicio.',
      data: { type: 'payment_guaranteed' },
    });
  }

  private async logAudit(params: {
    payment_id: string;
    previous_status?: string;
    new_status: string;
    source: 'admin' | 'webhook' | 'system' | 'client';
    changed_by?: string | null;
    mp_payment_id?: string;
    note?: string;
    metadata?: Record<string, any>;
  }) {
    const { error } = await this.db.from('payment_audit_logs').insert({
      payment_id: params.payment_id,
      previous_status: params.previous_status ?? null,
      new_status: params.new_status,
      source: params.source,
      changed_by: params.changed_by ?? null,
      mp_payment_id: params.mp_payment_id ?? null,
      note: params.note ?? null,
      metadata: params.metadata ?? null,
    });

    if (error) {
      this.logger.error(`Error registrando audit log: ${error.message}`);
    }
  }
}
