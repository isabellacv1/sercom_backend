import {
  BadRequestException,
  ConflictException,
  Injectable,
  InternalServerErrorException,
  Logger,
} from '@nestjs/common';
import { randomInt } from 'crypto';
import { SupabaseService } from '../supabase/supabase.service';
import { PushNotificationsService } from '../push-notifications/push-notifications.service';
import { CreditsService } from './credits.service';
import { getProConfig } from '../memberships/pro';

const CODE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; // sin 0/O/1/I

/** Crédito para cada uno cuando un cliente referido paga su primer servicio. */
export function referralCredit(): number {
  const value = Number(process.env.REFERRAL_CREDIT);
  return Number.isFinite(value) && value >= 0 && value <= 200000 ? Math.round(value) : 10000;
}

/**
 * "Invita y gana":
 *  - cliente invitado: al pagar su primer servicio, él y quien lo invitó
 *    reciben REFERRAL_CREDIT (10.000) de saldo SERCOM;
 *  - profesional invitado: al terminar su primer trabajo, quien lo invitó
 *    recibe un mes de SERCOM Pro (si es profesional) o el crédito.
 */
@Injectable()
export class ReferralsService {
  private readonly logger = new Logger(ReferralsService.name);

  constructor(
    private readonly supabaseService: SupabaseService,
    private readonly credits: CreditsService,
    private readonly pushService: PushNotificationsService,
  ) {}

  private get db() {
    return this.supabaseService.sbRaw;
  }

  async getMine(userId: string) {
    const code = await this.ensureCode(userId);
    const { data: invited } = await this.db
      .from('referrals')
      .select('status')
      .eq('referrer_id', userId);
    const { data: myReferral } = await this.db
      .from('referrals')
      .select('code, status')
      .eq('referred_id', userId)
      .maybeSingle();

    return {
      code,
      invited_count: (invited ?? []).length,
      rewarded_count: (invited ?? []).filter((r: any) => r.status === 'rewarded').length,
      credit_per_referral: referralCredit(),
      pro_days_per_worker: getProConfig().periodDays,
      referred_by_code: myReferral?.code ?? null,
      can_apply_code: !myReferral && !(await this.hasActivity(userId)),
      credit_balance: await this.credits.balance(userId),
    };
  }

  /** El usuario nuevo escribe el código de quien lo invitó. */
  async apply(userId: string, rawCode: string) {
    const code = rawCode.trim().toUpperCase();
    const { data: owner } = await this.db
      .from('referral_codes')
      .select('user_id')
      .eq('code', code)
      .maybeSingle();
    if (!owner) throw new BadRequestException('Este código de invitación no existe');
    if (owner.user_id === userId) {
      throw new BadRequestException('No puedes usar tu propio código');
    }

    const { data: existing } = await this.db
      .from('referrals')
      .select('id')
      .eq('referred_id', userId)
      .maybeSingle();
    if (existing) throw new ConflictException('Ya usaste un código de invitación');
    if (await this.hasActivity(userId)) {
      throw new BadRequestException('El código de invitación es solo para cuentas nuevas');
    }

    const { data: profile } = await this.db
      .from('profiles')
      .select('active_role')
      .eq('id', userId)
      .maybeSingle();

    const { error } = await this.db.from('referrals').insert({
      referrer_id: owner.user_id,
      referred_id: userId,
      code,
      referred_role: profile?.active_role === 'worker' ? 'worker' : 'client',
    });
    if (error) throw new InternalServerErrorException(error.message);
    return { message: 'Código aplicado. Recibirás tu recompensa al usar SERCOM.' };
  }

  /** Pago de servicio en custodia: premia al cliente invitado y a quien lo invitó. */
  async onClientPaymentHeld(clientId: string, paymentId: string) {
    const referral = await this.pending(clientId, 'client');
    if (!referral) return;
    if (!(await this.markRewarded(referral.id))) return;

    const credit = referralCredit();
    await this.credits.add(clientId, credit, 'Bienvenida por invitación', paymentId);
    await this.credits.add(referral.referrer_id, credit, 'Invitaste a un amigo', paymentId);
    await this.notify(clientId, '¡Ganaste saldo SERCOM!', `Tienes $${credit.toLocaleString('es-CO')} para tu próximo servicio.`);
    await this.notify(
      referral.referrer_id,
      '¡Tu invitado pagó su primer servicio!',
      `Ganaste $${credit.toLocaleString('es-CO')} de saldo SERCOM.`,
    );
  }

  /** Primer trabajo terminado de un profesional invitado. */
  async onWorkerJobCompleted(workerId: string, serviceId: string) {
    const referral = await this.pending(workerId, 'worker');
    if (!referral) return;
    if (!(await this.markRewarded(referral.id))) return;

    const { data: referrer } = await this.db
      .from('profiles')
      .select('roles, active_role')
      .eq('id', referral.referrer_id)
      .maybeSingle();
    const roles: string[] = Array.isArray(referrer?.roles) ? referrer.roles : [];

    if (roles.includes('worker') || referrer?.active_role === 'worker') {
      await this.grantProDays(referral.referrer_id, getProConfig().periodDays);
      await this.notify(
        referral.referrer_id,
        '¡Ganaste un mes de SERCOM Pro!',
        'El profesional que invitaste terminó su primer trabajo.',
      );
    } else {
      const credit = referralCredit();
      await this.credits.add(referral.referrer_id, credit, 'Invitaste a un profesional', serviceId);
      await this.notify(
        referral.referrer_id,
        '¡Ganaste saldo SERCOM!',
        `El profesional que invitaste terminó su primer trabajo: $${credit.toLocaleString('es-CO')} para ti.`,
      );
    }
  }

  // ─── Helpers ───────────────────────────────────────────────────────────

  private async ensureCode(userId: string): Promise<string> {
    const { data: existing } = await this.db
      .from('referral_codes')
      .select('code')
      .eq('user_id', userId)
      .maybeSingle();
    if (existing) return existing.code;

    const { data: profile } = await this.db
      .from('profiles')
      .select('full_name')
      .eq('id', userId)
      .maybeSingle();
    const name = (profile?.full_name ?? 'SERCOM')
      .split(/\s+/)[0]
      .normalize('NFD')
      .replace(/[̀-ͯ]/g, '')
      .replace(/[^A-Za-z]/g, '')
      .toUpperCase()
      .slice(0, 8) || 'SERCOM';

    for (let attempt = 0; attempt < 5; attempt++) {
      const suffix = Array.from({ length: 4 }, () => CODE_ALPHABET[randomInt(CODE_ALPHABET.length)]).join('');
      const code = `${name}-${suffix}`;
      const { error } = await this.db.from('referral_codes').insert({ user_id: userId, code });
      if (!error) return code;
    }
    throw new InternalServerErrorException('No se pudo generar tu código de invitación');
  }

  /** Ya pagó un servicio o ya terminó un trabajo: no es una cuenta nueva. */
  private async hasActivity(userId: string) {
    const { count: paid } = await this.db
      .from('payments')
      .select('id', { count: 'exact', head: true })
      .eq('client_id', userId)
      .in('status', ['held', 'released', 'disbursed']);
    const { count: jobs } = await this.db
      .from('services')
      .select('id', { count: 'exact', head: true })
      .eq('assigned_worker_id', userId)
      .eq('status', 'completed');
    return (paid ?? 0) + (jobs ?? 0) > 0;
  }

  private async pending(userId: string, role: 'client' | 'worker') {
    const { data } = await this.db
      .from('referrals')
      .select('id, referrer_id')
      .eq('referred_id', userId)
      .eq('referred_role', role)
      .eq('status', 'pending')
      .maybeSingle();
    return data;
  }

  /** Marca la recompensa una sola vez (evita premiar dos veces). */
  private async markRewarded(referralId: string) {
    const { data } = await this.db
      .from('referrals')
      .update({ status: 'rewarded', rewarded_at: new Date().toISOString() })
      .eq('id', referralId)
      .eq('status', 'pending')
      .select('id')
      .maybeSingle();
    return !!data;
  }

  private async grantProDays(workerId: string, days: number) {
    const now = new Date();
    const { data: current } = await this.db
      .from('worker_memberships')
      .select('period_end')
      .eq('worker_id', workerId)
      .eq('status', 'active')
      .gt('period_end', now.toISOString())
      .order('period_end', { ascending: false })
      .limit(1)
      .maybeSingle();
    const start = current?.period_end ? new Date(current.period_end) : now;
    const end = new Date(start.getTime() + days * 86400000);
    const { error } = await this.db.from('worker_memberships').insert({
      worker_id: workerId,
      plan: 'pro',
      status: 'active',
      amount: 0,
      period_start: start.toISOString(),
      period_end: end.toISOString(),
      provider_status: 'REFERRAL',
    });
    if (error) this.logger.error(`No se pudo otorgar Pro por referido: ${error.message}`);
  }

  private async notify(userId: string, title: string, body: string) {
    await this.pushService.sendToUser(userId, { title, body, data: { type: 'referral_reward' } });
  }
}
