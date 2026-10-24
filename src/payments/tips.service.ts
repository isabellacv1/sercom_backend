import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  InternalServerErrorException,
  Logger,
  NotFoundException,
  ServiceUnavailableException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { SupabaseService } from '../supabase/supabase.service';
import { PushNotificationsService } from '../push-notifications/push-notifications.service';
import { WompiService, WompiTransaction } from './wompi.service';
import { CreateTipDto } from './dto/create-tip.dto';
import { CompletePayoutDto } from './dto/complete-payout.dto';

/** Prefijo de las referencias Wompi de propinas. */
export const TIP_REFERENCE_PREFIX = 'tip_';

/**
 * Propinas del cliente al profesional al terminar un servicio. El 100% es
 * para el profesional (SerCom no cobra comisión); se le transfiere junto
 * con sus pagos (payout manual).
 */
@Injectable()
export class TipsService {
  private readonly logger = new Logger(TipsService.name);
  private readonly frontendUrl: string;

  constructor(
    private readonly supabaseService: SupabaseService,
    private readonly wompi: WompiService,
    private readonly pushService: PushNotificationsService,
    configService: ConfigService,
  ) {
    this.frontendUrl =
      configService.get<string>('PAYMENTS_FRONTEND_URL') ??
      'https://sercom-frontend.vercel.app';
  }

  private get db() {
    return this.supabaseService.sbRaw;
  }

  async getForService(userId: string, serviceId: string) {
    const service = await this.requireService(serviceId);
    if (service.client_id !== userId && service.assigned_worker_id !== userId) {
      throw new ForbiddenException('No tienes acceso a este servicio');
    }

    await this.syncPending(serviceId);

    const { data: tip } = await this.db
      .from('service_tips')
      .select('id, amount, status, paid_at')
      .eq('service_id', serviceId)
      .eq('status', 'paid')
      .maybeSingle();

    const { data: worker } = await this.db
      .from('profiles')
      .select('full_name')
      .eq('id', service.assigned_worker_id)
      .maybeSingle();

    return {
      tip: tip ?? null,
      can_tip: service.client_id === userId && service.status === 'completed' && !tip,
      worker_name: worker?.full_name ?? null,
    };
  }

  async createCheckout(clientId: string, serviceId: string, dto: CreateTipDto) {
    if (!this.wompi.isConfigured) {
      throw new ServiceUnavailableException('Los pagos no están configurados');
    }
    const service = await this.requireService(serviceId);
    if (service.client_id !== clientId) {
      throw new ForbiddenException('Solo el cliente del servicio puede dar propina');
    }
    if (service.status !== 'completed') {
      throw new BadRequestException('Puedes dar propina cuando el servicio haya terminado');
    }

    const { data: paid } = await this.db
      .from('service_tips')
      .select('id')
      .eq('service_id', serviceId)
      .eq('status', 'paid')
      .maybeSingle();
    if (paid) throw new ConflictException('Ya diste una propina en este servicio');

    const { data: row, error } = await this.db
      .from('service_tips')
      .insert({
        service_id: serviceId,
        client_id: clientId,
        worker_id: service.assigned_worker_id,
        amount: dto.amount,
        status: 'pending',
      })
      .select('id')
      .single();
    if (error) throw new InternalServerErrorException(error.message);

    const { data: client } = await this.db
      .from('profiles')
      .select('email, full_name')
      .eq('id', clientId)
      .maybeSingle();

    const reference = `${TIP_REFERENCE_PREFIX}${row.id}_${Date.now().toString(36)}`;
    const checkoutUrl = this.wompi.buildCheckoutUrl({
      reference,
      amountInCents: dto.amount * 100,
      currency: 'COP',
      redirectUrl: this.frontendUrl,
      customerEmail: client?.email,
      customerName: client?.full_name,
    });

    await this.db
      .from('service_tips')
      .update({ checkout_reference: reference, updated_at: new Date().toISOString() })
      .eq('id', row.id);

    return { checkout_url: checkoutUrl, tip_id: row.id, amount: dto.amount };
  }

  /** Llamado por el webhook de Wompi para referencias "tip_…". */
  async applyWompiTransaction(tx: WompiTransaction) {
    const tipId = tx.reference.slice(TIP_REFERENCE_PREFIX.length).split('_')[0];
    const { data: row } = await this.db
      .from('service_tips')
      .select('*')
      .eq('id', tipId)
      .maybeSingle();
    if (!row) {
      this.logger.warn(`Propina ${tipId} no encontrada (tx ${tx.id})`);
      return;
    }
    await this.apply(row, tx);
  }

  private async apply(row: any, tx: WompiTransaction) {
    if (row.status !== 'pending') return; // idempotente
    const now = new Date().toISOString();

    if (tx.status === 'APPROVED') {
      if (tx.amount_in_cents !== Math.round(Number(row.amount) * 100)) {
        this.logger.error(`Propina ${row.id}: monto ${tx.amount_in_cents} no coincide con ${row.amount}`);
        return;
      }
      const { data: paid } = await this.db
        .from('service_tips')
        .update({
          status: 'paid',
          paid_at: now,
          payout_status: 'pending_manual',
          provider_transaction_id: tx.id,
          provider_status: tx.status,
          updated_at: now,
        })
        .eq('id', row.id)
        .eq('status', 'pending')
        .select('id')
        .maybeSingle();

      if (paid && row.worker_id) {
        await this.pushService.sendToUser(row.worker_id, {
          title: '¡Recibiste una propina!',
          body: `Un cliente te dejó ${this.formatCop(row.amount)} de propina. Es 100% para ti.`,
          data: { type: 'tip_received', service_id: String(row.service_id) },
        });
      }
      return;
    }

    if (['DECLINED', 'ERROR', 'VOIDED'].includes(tx.status)) {
      await this.db
        .from('service_tips')
        .update({ status: 'failed', provider_transaction_id: tx.id, provider_status: tx.status, updated_at: now })
        .eq('id', row.id)
        .eq('status', 'pending');
    }
  }

  /** Respaldo del webhook: consulta a Wompi los intentos pendientes. */
  private async syncPending(serviceId: string) {
    if (!this.wompi.isConfigured) return;
    const { data: pending } = await this.db
      .from('service_tips')
      .select('*')
      .eq('service_id', serviceId)
      .eq('status', 'pending')
      .not('checkout_reference', 'is', null);

    for (const row of pending ?? []) {
      try {
        const txs = await this.wompi.findTransactionsByReference(row.checkout_reference);
        const tx = txs.find((t) => t.status === 'APPROVED') ?? txs[0];
        if (tx) await this.apply(row, tx);
      } catch (err) {
        this.logger.warn(`No se pudo sincronizar propina ${row.id}: ${(err as Error).message}`);
      }
    }
  }

  // ─── Para la billetera del profesional y el listado del admin ───────────

  async workerTipTotals(workerId: string) {
    const { data } = await this.db
      .from('service_tips')
      .select('amount, payout_status')
      .eq('worker_id', workerId)
      .eq('status', 'paid');
    const rows = data ?? [];
    const sum = (f: (r: any) => boolean) =>
      rows.filter(f).reduce((s, r) => s + Number(r.amount ?? 0), 0);
    return {
      pending: sum((r) => r.payout_status !== 'completed'),
      paid_out: sum((r) => r.payout_status === 'completed'),
      total: sum(() => true),
    };
  }

  async pendingPayouts() {
    const { data } = await this.db
      .from('service_tips')
      .select('id, service_id, worker_id, amount, paid_at, services:service_id(title)')
      .eq('status', 'paid')
      .eq('payout_status', 'pending_manual')
      .order('paid_at', { ascending: true });
    return data ?? [];
  }

  async completePayout(tipId: string, dto: CompletePayoutDto) {
    const now = new Date().toISOString();
    const { data, error } = await this.db
      .from('service_tips')
      .update({
        payout_status: 'completed',
        disbursed_at: now,
        external_transfer_id: dto.reference,
        updated_at: now,
      })
      .eq('id', tipId)
      .eq('status', 'paid')
      .eq('payout_status', 'pending_manual')
      .select('id, worker_id, amount')
      .maybeSingle();

    if (error) throw new InternalServerErrorException(error.message);
    if (!data) throw new NotFoundException('Propina pendiente no encontrada');

    if (data.worker_id) {
      await this.pushService.sendToUser(data.worker_id, {
        title: 'Propina transferida',
        body: `Te transferimos ${this.formatCop(data.amount)} de propina.`,
        data: { type: 'tip_disbursed' },
      });
    }
    return { message: 'Transferencia de propina registrada', tip: data };
  }

  private async requireService(serviceId: string) {
    const { data, error } = await this.db
      .from('services')
      .select('id, client_id, assigned_worker_id, status')
      .eq('id', serviceId)
      .maybeSingle();
    if (error) throw new InternalServerErrorException(error.message);
    if (!data) throw new NotFoundException('Servicio no encontrado');
    return data;
  }

  private formatCop(amount: number | string) {
    return `$${Number(amount).toLocaleString('es-CO')} COP`;
  }
}
