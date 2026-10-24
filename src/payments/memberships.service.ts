import {
  ForbiddenException,
  Injectable,
  InternalServerErrorException,
  Logger,
  ServiceUnavailableException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { SupabaseService } from '../supabase/supabase.service';
import { PushNotificationsService } from '../push-notifications/push-notifications.service';
import { WompiService, WompiTransaction } from './wompi.service';
import { CreditsService } from './credits.service';
import {
  getCareConfig,
  getPlusConfig,
  getProConfig,
  isProWorker,
  proposalsThisMonth,
} from '../memberships/pro';

/** pro = profesionales; plus = clientes (Rappi Prime); care = mantenimiento. */
export type MembershipPlan = 'pro' | 'plus' | 'care';

function planConfig(plan: MembershipPlan) {
  if (plan === 'care') {
    const c = getCareConfig();
    return { name: 'Hogar Tranquilo', monthlyPrice: c.monthlyPrice, periodDays: c.periodDays };
  }
  if (plan === 'plus') {
    const c = getPlusConfig();
    return { name: 'SERCOM Plus', monthlyPrice: c.monthlyPrice, periodDays: c.periodDays };
  }
  const c = getProConfig();
  return { name: 'SERCOM Pro', monthlyPrice: c.monthlyPrice, periodDays: c.periodDays };
}

/** Prefijo de las referencias Wompi de membresía (las de servicios son uuid). */
export const MEMBERSHIP_REFERENCE_PREFIX = 'mem_';

/**
 * Compra y activación de SERCOM Pro con Wompi. Cada pago activa (o extiende)
 * el plan por PRO_PERIOD_DAYS; no hay cobro recurrente automático.
 */
@Injectable()
export class MembershipsService {
  private readonly logger = new Logger(MembershipsService.name);
  private readonly frontendUrl: string;

  constructor(
    private readonly supabaseService: SupabaseService,
    private readonly wompi: WompiService,
    private readonly pushService: PushNotificationsService,
    private readonly credits: CreditsService,
    configService: ConfigService,
  ) {
    this.frontendUrl =
      configService.get<string>('PAYMENTS_FRONTEND_URL') ??
      'https://sercom-frontend.vercel.app';
  }

  private get db() {
    return this.supabaseService.sbRaw;
  }

  /** Estado de SERCOM Plus del cliente. */
  async getPlus(userId: string) {
    await this.syncPending(userId);
    const config = getPlusConfig();
    const active = await this.activeMembership(userId, 'plus');
    return {
      is_plus: !!active,
      period_end: active?.period_end ?? null,
      plan: {
        name: 'SERCOM Plus',
        monthly_price: config.monthlyPrice,
        period_days: config.periodDays,
        warranty_days: config.warrantyDays,
        standard_warranty_days: config.standardWarrantyDays,
      },
    };
  }

  /** Plan de mantenimiento "Hogar Tranquilo" del cliente. */
  async getCare(userId: string) {
    await this.syncPending(userId);
    const config = getCareConfig();
    const active = await this.activeMembership(userId, 'care');

    // Próxima revisión: cada CARE_CHECKUP_DAYS desde el primer mes del plan.
    let nextCheckup: string | null = null;
    if (active) {
      const { data: first } = await this.db
        .from('worker_memberships')
        .select('period_start')
        .eq('worker_id', userId)
        .eq('plan', 'care')
        .eq('status', 'active')
        .order('period_start', { ascending: true })
        .limit(1)
        .maybeSingle();
      const start = new Date(first?.period_start ?? active.period_start).getTime();
      const step = config.checkupEveryDays * 86400000;
      let next = start + step;
      while (next < Date.now() - 7 * 86400000) next += step;
      nextCheckup = new Date(next).toISOString();
    }

    return {
      is_active: !!active,
      period_end: active?.period_end ?? null,
      next_checkup_at: nextCheckup,
      plan: {
        name: 'Hogar Tranquilo',
        monthly_price: config.monthlyPrice,
        monthly_credit: config.monthlyCredit,
        period_days: config.periodDays,
        checkup_every_days: config.checkupEveryDays,
        warranty_days: getPlusConfig().warrantyDays,
      },
    };
  }

  private async activeMembership(userId: string, plan: MembershipPlan) {
    const { data } = await this.db
      .from('worker_memberships')
      .select('id, period_start, period_end')
      .eq('worker_id', userId)
      .eq('plan', plan)
      .eq('status', 'active')
      .gt('period_end', new Date().toISOString())
      .order('period_end', { ascending: false })
      .limit(1)
      .maybeSingle();
    return data;
  }

  async getMine(workerId: string) {
    await this.requireWorker(workerId);
    await this.syncPending(workerId);

    const config = getProConfig();
    const { data: active } = await this.db
      .from('worker_memberships')
      .select('id, period_start, period_end')
      .eq('worker_id', workerId)
      .eq('plan', 'pro')
      .eq('status', 'active')
      .gt('period_end', new Date().toISOString())
      .order('period_end', { ascending: false })
      .limit(1)
      .maybeSingle();

    return {
      is_pro: !!active,
      period_end: active?.period_end ?? null,
      proposals_this_month: await proposalsThisMonth(this.db, workerId),
      plan: {
        name: 'SERCOM Pro',
        monthly_price: config.monthlyPrice,
        period_days: config.periodDays,
        pro_commission_rate: config.workerCommissionRate,
        free_monthly_proposals: config.freeMonthlyProposals,
      },
    };
  }

  async createCheckout(workerId: string, plan: MembershipPlan = 'pro') {
    if (!this.wompi.isConfigured) {
      throw new ServiceUnavailableException('Los pagos no están configurados');
    }
    const profile =
      plan === 'pro' ? await this.requireWorker(workerId) : await this.requireProfile(workerId);
    const { monthlyPrice } = planConfig(plan);

    const { data: row, error } = await this.db
      .from('worker_memberships')
      .insert({ worker_id: workerId, plan, status: 'pending', amount: monthlyPrice })
      .select('id')
      .single();
    if (error) throw new InternalServerErrorException(error.message);

    const reference = `${MEMBERSHIP_REFERENCE_PREFIX}${row.id}_${Date.now().toString(36)}`;
    const checkoutUrl = this.wompi.buildCheckoutUrl({
      reference,
      amountInCents: monthlyPrice * 100,
      currency: 'COP',
      redirectUrl: this.frontendUrl,
      customerEmail: profile.email,
      customerName: profile.full_name,
    });

    await this.db
      .from('worker_memberships')
      .update({ checkout_reference: reference, updated_at: new Date().toISOString() })
      .eq('id', row.id);

    return { checkout_url: checkoutUrl, membership_id: row.id, amount: monthlyPrice };
  }

  /** Llamado por el webhook de Wompi para referencias "mem_…". */
  async applyWompiTransaction(tx: WompiTransaction) {
    const membershipId = tx.reference
      .slice(MEMBERSHIP_REFERENCE_PREFIX.length)
      .split('_')[0];
    const { data: row } = await this.db
      .from('worker_memberships')
      .select('*')
      .eq('id', membershipId)
      .maybeSingle();
    if (!row) {
      this.logger.warn(`Membresía ${membershipId} no encontrada (tx ${tx.id})`);
      return;
    }
    await this.apply(row, tx);
  }

  private async apply(row: any, tx: WompiTransaction) {
    if (row.status !== 'pending') return; // ya resuelta (idempotente)
    const now = new Date();

    if (tx.status === 'APPROVED') {
      if (tx.amount_in_cents !== Math.round(Number(row.amount) * 100)) {
        this.logger.error(
          `Membresía ${row.id}: monto ${tx.amount_in_cents} no coincide con ${row.amount}`,
        );
        return;
      }

      // Si ya tenía el plan, el nuevo periodo empieza cuando termina el vigente.
      const plan: MembershipPlan =
        row.plan === 'plus' ? 'plus' : row.plan === 'care' ? 'care' : 'pro';
      const { data: current } = await this.db
        .from('worker_memberships')
        .select('period_end')
        .eq('worker_id', row.worker_id)
        .eq('plan', plan)
        .eq('status', 'active')
        .gt('period_end', now.toISOString())
        .order('period_end', { ascending: false })
        .limit(1)
        .maybeSingle();
      const start = current?.period_end ? new Date(current.period_end) : now;
      const end = new Date(start.getTime() + planConfig(plan).periodDays * 86400000);

      const { data: activated } = await this.db
        .from('worker_memberships')
        .update({
          status: 'active',
          period_start: start.toISOString(),
          period_end: end.toISOString(),
          provider_transaction_id: tx.id,
          provider_status: tx.status,
          updated_at: now.toISOString(),
        })
        .eq('id', row.id)
        .eq('status', 'pending')
        .select('id')
        .maybeSingle();

      if (activated && plan === 'care') {
        // Saldo del mes para servicios de mantenimiento.
        const credit = getCareConfig().monthlyCredit;
        if (credit > 0) {
          await this.credits.add(row.worker_id, credit, 'Saldo del plan Hogar Tranquilo', row.id);
        }
        await this.pushService.sendToUser(row.worker_id, {
          title: '¡Bienvenido a Hogar Tranquilo!',
          body: `Tienes $${credit.toLocaleString('es-CO')} de saldo para mantenimiento y todos los beneficios de Plus.`,
          data: { type: 'membership_active', plan },
        });
      } else if (activated) {
        await this.pushService.sendToUser(
          row.worker_id,
          plan === 'plus'
            ? {
                title: '¡Ya eres SERCOM Plus!',
                body: 'Sin tarifa de servicio, atención prioritaria y garantía extendida.',
                data: { type: 'membership_active', plan },
              }
            : {
                title: '¡Ya eres SERCOM Pro!',
                body: 'Apareces primero, pagas menos comisión y envías propuestas sin límite.',
                data: { type: 'membership_active', plan },
              },
        );
      }
      return;
    }

    if (['DECLINED', 'ERROR', 'VOIDED'].includes(tx.status)) {
      await this.db
        .from('worker_memberships')
        .update({
          status: 'failed',
          provider_transaction_id: tx.id,
          provider_status: tx.status,
          updated_at: now.toISOString(),
        })
        .eq('id', row.id)
        .eq('status', 'pending');
    }
  }

  /** Respaldo del webhook: consulta a Wompi los intentos pendientes. */
  private async syncPending(workerId: string) {
    if (!this.wompi.isConfigured) return;
    const { data: pending } = await this.db
      .from('worker_memberships')
      .select('*')
      .eq('worker_id', workerId)
      .eq('status', 'pending')
      .not('checkout_reference', 'is', null)
      .gt('created_at', new Date(Date.now() - 2 * 86400000).toISOString());

    for (const row of pending ?? []) {
      try {
        const txs = await this.wompi.findTransactionsByReference(row.checkout_reference);
        const tx = txs.find((t) => t.status === 'APPROVED') ?? txs[0];
        if (tx) await this.apply(row, tx);
      } catch (err) {
        this.logger.warn(`No se pudo sincronizar membresía ${row.id}: ${(err as Error).message}`);
      }
    }
  }

  private async requireProfile(userId: string) {
    const { data } = await this.db
      .from('profiles')
      .select('id, email, full_name')
      .eq('id', userId)
      .maybeSingle();
    if (!data) throw new ForbiddenException('Perfil no encontrado');
    return data;
  }

  private async requireWorker(workerId: string) {
    const { data } = await this.db
      .from('profiles')
      .select('id, email, full_name, roles, active_role')
      .eq('id', workerId)
      .maybeSingle();
    const roles: string[] = Array.isArray(data?.roles) ? data.roles : [];
    if (!data || (!roles.includes('worker') && data.active_role !== 'worker')) {
      throw new ForbiddenException('SERCOM Pro es para profesionales');
    }
    return data;
  }

  isPro(workerId: string) {
    return isProWorker(this.db, workerId);
  }
}
