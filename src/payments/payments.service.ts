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
  InvalidWebhookSignatureError,
} from 'mercadopago';
import { SupabaseService } from '../supabase/supabase.service';
import { PushNotificationsService } from '../push-notifications/push-notifications.service';
import { CreateMercadoPagoLinkDto } from './dto/create-mercadopago-link.dto';
import { ConfirmMercadoPagoPaymentDto } from './dto/confirm-mercadopago-payment.dto';
import { ReleasePaymentDto } from './dto/release-payment.dto';
import { RefundPaymentDto } from './dto/refund-payment.dto';

type PaymentStatus = 'pending' | 'held' | 'released' | 'refunded' | 'failed';

@Injectable()
export class PaymentsService {
  private readonly logger = new Logger(PaymentsService.name);
  private readonly mpClient: MercadoPagoConfig;
  private readonly webhookSecret: string | undefined;
  private readonly appUrl: string;
  private readonly isProduction: boolean;

  constructor(
    private readonly supabaseService: SupabaseService,
    private readonly configService: ConfigService,
    private readonly pushService: PushNotificationsService,
  ) {
    const accessToken = this.configService.get<string>('MP_ACCESS_TOKEN');
    this.webhookSecret = this.configService.get<string>('MP_WEBHOOK_SECRET');
    this.appUrl = this.configService.get<string>('APP_URL') ?? '';

    if (!this.appUrl) {
      this.logger.error(
        'APP_URL no está configurada. Las notification_url y back_urls de Mercado Pago serán inválidas.',
      );
    } else if (this.appUrl.includes('localhost') || this.appUrl.includes('127.0.0.1')) {
      this.logger.warn(
        `APP_URL apunta a "${this.appUrl}". Mercado Pago no puede alcanzar localhost. Usa un túnel (ngrok) o el dominio de producción.`,
      );
    }

    // El entorno lo determina el propio token, no NODE_ENV.
    // APP_USR-... → producción (init_point)
    // TEST-...    → sandbox   (sandbox_init_point)
    this.isProduction =
      this.configService.get<string>('MP_ENVIRONMENT') === 'production';

    if (!accessToken) {
      this.logger.warn(
        'MP_ACCESS_TOKEN no configurado. La integración con Mercado Pago está desactivada.',
      );
      this.mpClient = new MercadoPagoConfig({ accessToken: 'placeholder' });
    } else {
      this.logger.log(
        `Mercado Pago inicializado en modo ${this.isProduction ? 'PRODUCCIÓN' : 'SANDBOX'}.`,
      );
      this.mpClient = new MercadoPagoConfig({ accessToken });
    }
  }

  // Alias para evitar repetición
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

    // Reutilizar preference existente para evitar duplicación
    if (payment.mp_preference_id && payment.status === 'pending') {
      return this.buildCheckoutResponse(payment, payment.checkout_url);
    }

    if (payment.status === 'held') {
      const svc = await this.getServiceBasicData(service.id);
      return {
        message: 'El pago ya fue aprobado y está retenido por la plataforma',
        payment,
        receipt: this.buildReceipt(payment, svc),
      };
    }

    this.guardFinalStatus(payment.status as PaymentStatus);

    const accessToken = this.configService.get<string>('MP_ACCESS_TOKEN');
    if (!accessToken) {
      const fallbackUrl = this.configService.get<string>('MP_CHECKOUT_URL');
      if (!fallbackUrl) {
        throw new InternalServerErrorException(
          'MP_ACCESS_TOKEN y MP_CHECKOUT_URL no están configurados.',
        );
      }
      const { data: updated } = await this.db
        .from('payments')
        .update({
          checkout_url: fallbackUrl,
          updated_at: new Date().toISOString(),
        })
        .eq('id', payment.id)
        .select()
        .single();
      return this.buildCheckoutResponse(updated, fallbackUrl);
    }

    // Datos del cliente
    const { data: clientProfile } = await this.db
      .from('profiles')
      .select('full_name')
      .eq('id', clientId)
      .maybeSingle();

    const preferenceAPI = new Preference(this.mpClient);
    let preferenceResult: any;

    try {
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
          payer: {
            name: clientProfile?.full_name ?? '',
          },
          notification_url: `${this.appUrl}/payments/webhook/mercadopago`,
          back_urls: {
            success: `${this.appUrl}/payments/result/success`,
            failure: `${this.appUrl}/payments/result/failure`,
            pending: `${this.appUrl}/payments/result/pending`,
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
    } catch (err) {
      this.logger.error(
        `Error creando preference MP: ${(err as Error).message}`,
      );
      throw new InternalServerErrorException(
        'No se pudo generar el link de pago. Intenta nuevamente.',
      );
    }

    const checkoutUrl = this.isProduction
      ? preferenceResult.init_point
      : preferenceResult.sandbox_init_point;

    const { data: updated, error: updateError } = await this.db
      .from('payments')
      .update({
        mp_preference_id: preferenceResult.id,
        checkout_url: checkoutUrl,
        provider: 'mercadopago',
        payment_method: dto.payment_method ?? 'mercadopago_checkout',
        updated_at: new Date().toISOString(),
      })
      .eq('id', payment.id)
      .select()
      .single();

    if (updateError) {
      throw new InternalServerErrorException(updateError.message);
    }

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

  // ─── Confirmación manual por admin (fallback para link fijo) ────────────────

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

    // Notificar al cliente
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
    if (this.webhookSecret && process.env.NODE_ENV === 'production') {
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

    const accessToken = this.configService.get<string>('MP_ACCESS_TOKEN');
    if (!accessToken) {
      this.logger.warn(
        'MP_ACCESS_TOKEN no configurado; no se puede verificar el pago',
      );
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
      this.logger.debug(
        `Webhook duplicado para mp_payment_id=${mpPaymentId}. Ignorando.`,
      );
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

    // Intentar reembolso vía API de MP si tenemos el ID real del pago
    if (payment.mp_payment_id && this.configService.get('MP_ACCESS_TOKEN')) {
      try {
        const { PaymentRefund } = await import('mercadopago');
        const refundAPI = new PaymentRefund(this.mpClient);
        await refundAPI.create({ payment_id: payment.mp_payment_id, body: {} });
      } catch (err) {
        this.logger.error(
          `Error al reembolsar en MP payment_id=${payment.mp_payment_id}: ${(err as Error).message}`,
        );
        // Continuar flujo interno; el admin deberá gestionar en portal de MP
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

  private guardFinalStatus(status: PaymentStatus) {
    if (status === 'released') {
      throw new BadRequestException('Este pago ya fue liberado');
    }
    if (status === 'refunded') {
      throw new BadRequestException('Este pago ya fue reembolsado');
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
