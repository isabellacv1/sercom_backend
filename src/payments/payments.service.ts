import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  InternalServerErrorException,
  NotFoundException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { SupabaseService } from '../supabase/supabase.service';
import { CreateMercadoPagoLinkDto } from './dto/create-mercadopago-link.dto';
import { ConfirmMercadoPagoPaymentDto } from './dto/confirm-mercadopago-payment.dto';

@Injectable()
export class PaymentsService {
  private readonly mercadoPagoLink =
    'https://link.mercadopago.com.co/sercomi';

  constructor(
    private readonly supabaseService: SupabaseService,
    private readonly configService: ConfigService,
  ) {}

  async createMercadoPagoLink(
    clientId: string,
    dto: CreateMercadoPagoLinkDto,
  ) {
    const { data: service, error: serviceError } =
      await this.supabaseService.sb
        .from('services')
        .select(
          `
          id,
          client_id,
          assigned_worker_id,
          status,
          title
        `,
        )
        .eq('id', dto.service_id)
        .maybeSingle();

    if (serviceError) {
      throw new InternalServerErrorException(serviceError.message);
    }

    if (!service) {
      throw new NotFoundException('Servicio no encontrado');
    }

    if (service.client_id !== clientId) {
      throw new ForbiddenException(
        'No puedes pagar un servicio que no te pertenece',
      );
    }

    if (service.status !== 'assigned') {
      throw new BadRequestException(
        'Solo puedes pagar un servicio que tenga técnico asignado',
      );
    }

    if (!service.assigned_worker_id) {
      throw new BadRequestException('El servicio no tiene técnico asignado');
    }

    const { data: payment, error: paymentError } =
      await this.supabaseService.sb
        .from('payments')
        .select('*')
        .eq('service_id', service.id)
        .eq('client_id', clientId)
        .maybeSingle();

    if (paymentError) {
      throw new InternalServerErrorException(paymentError.message);
    }

    if (!payment) {
      throw new NotFoundException(
        'No existe un pago pendiente para este servicio. Primero debes aceptar una propuesta.',
      );
    }

    if (payment.status === 'held') {
      return {
        message: 'El pago ya fue aprobado y está retenido por la plataforma',
        payment,
        receipt: this.buildReceipt(payment),
      };
    }

    if (payment.status === 'released') {
      throw new BadRequestException('Este pago ya fue liberado');
    }

    if (payment.status === 'refunded') {
      throw new BadRequestException('Este pago ya fue reembolsado');
    }

    const { data: updatedPayment, error: updateError } =
      await this.supabaseService.sb
        .from('payments')
        .update({
          provider: 'mercadopago',
          payment_method: 'mercadopago_link',
          checkout_url: this.mercadoPagoLink,
          updated_at: new Date().toISOString(),
        } as any)
        .eq('id', payment.id)
        .select()
        .single();

    if (updateError) {
      throw new InternalServerErrorException(updateError.message);
    }

    return {
      message: 'Link de pago de Mercado Pago generado correctamente',
      payment: updatedPayment,
      checkout_url: this.mercadoPagoLink,
      instructions:
        'Después de pagar, la plataforma debe verificar el pago en Mercado Pago y confirmar manualmente la retención.',
    };
  }

  async findByService(userId: string, serviceId: string) {
    const { data: payment, error } = await this.supabaseService.sb
      .from('payments')
      .select('*')
      .eq('service_id', serviceId)
      .maybeSingle();

    if (error) {
      throw new InternalServerErrorException(error.message);
    }

    if (!payment) {
      throw new NotFoundException('Pago no encontrado');
    }

    const isParticipant =
      payment.client_id === userId || payment.worker_id === userId;

    const isAdmin = await this.isAdmin(userId);

    if (!isParticipant && !isAdmin) {
      throw new ForbiddenException('No puedes ver este pago');
    }

    return {
      payment,
      receipt: payment.status === 'held' ? this.buildReceipt(payment) : null,
    };
  }

  async confirmMercadoPagoPayment(
    userId: string,
    paymentId: string,
    dto: ConfirmMercadoPagoPaymentDto,
  ) {
    const isAdmin = await this.isAdmin(userId);

    if (!isAdmin) {
      throw new ForbiddenException(
        'Solo un administrador puede confirmar pagos de Mercado Pago con link fijo',
      );
    }

    const { data: payment, error } = await this.supabaseService.sb
      .from('payments')
      .select('*')
      .eq('id', paymentId)
      .maybeSingle();

    if (error) {
      throw new InternalServerErrorException(error.message);
    }

    if (!payment) {
      throw new NotFoundException('Pago no encontrado');
    }

    if (payment.status === 'released') {
      throw new BadRequestException('Este pago ya fue liberado');
    }

    if (payment.status === 'refunded') {
      throw new BadRequestException('Este pago ya fue reembolsado');
    }

    if (dto.result === 'rejected') {
      const { data: failedPayment, error: failedError } =
        await this.supabaseService.sb
          .from('payments')
          .update({
            status: 'failed',
            provider: 'mercadopago',
            payment_method: 'mercadopago_link',
            provider_reference: dto.provider_reference ?? null,
            updated_at: new Date().toISOString(),
          } as any)
          .eq('id', paymentId)
          .select()
          .single();

      if (failedError) {
        throw new InternalServerErrorException(failedError.message);
      }

      return {
        message: 'Pago rechazado. El servicio no puede iniciar.',
        payment: failedPayment,
      };
    }

    const paidAt = new Date().toISOString();
    const receiptNumber = `MP-${payment.id}`;

    const { data: heldPayment, error: heldError } =
      await this.supabaseService.sb
        .from('payments')
        .update({
          status: 'held',
          paid_at: paidAt,
          provider: 'mercadopago',
          payment_method: 'mercadopago_link',
          provider_reference: dto.provider_reference ?? receiptNumber,
          receipt_number: receiptNumber,
          updated_at: paidAt,
        } as any)
        .eq('id', paymentId)
        .select()
        .single();

    if (heldError) {
      throw new InternalServerErrorException(heldError.message);
    }

    /**
     * Aquí luego conectas push notification:
     * trabajador recibe: "Pago garantizado por el cliente".
     */

    return {
      message:
        'Pago aprobado. El dinero queda retenido bajo custodia de la plataforma.',
      payment: heldPayment,
      receipt: this.buildReceipt(heldPayment),
      worker_notification: {
        worker_id: heldPayment.worker_id,
        title: 'Pago garantizado',
        body: 'El cliente garantizó el pago. Puedes iniciar el servicio.',
      },
    };
  }

  private async isAdmin(userId: string): Promise<boolean> {
    const { data, error } = await this.supabaseService.sb
      .from('profiles')
      .select('id, roles, active_role')
      .eq('id', userId)
      .maybeSingle();

    if (error) {
      throw new InternalServerErrorException(error.message);
    }

    if (!data) {
      return false;
    }

    const roles = Array.isArray(data.roles) ? data.roles : [];

    return roles.includes('admin') || data.active_role === 'admin';
  }

  private buildReceipt(payment: any) {
    return {
      receipt_number: payment.receipt_number ?? `PAY-${payment.id}`,
      payment_id: payment.id,
      service_id: payment.service_id,
      amount_total: payment.amount_total,
      commission_amount: payment.commission_amount,
      worker_amount: payment.worker_amount,
      currency: payment.currency,
      provider: payment.provider,
      provider_reference: payment.provider_reference,
      payment_method: payment.payment_method,
      status: payment.status,
      paid_at: payment.paid_at,
      message: 'Pago retenido bajo custodia segura de la plataforma',
    };
  }
}