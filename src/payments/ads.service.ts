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
import { BuyBoostDto } from './dto/gift-and-ads.dto';
import { getBoostPrices } from '../memberships/ads';

export const AD_REFERENCE_PREFIX = 'ad_';

/**
 * SERCOM Ads: el profesional paga para salir "Destacado" (primero en
 * propuestas y búsquedas, y en el carrusel del inicio del cliente).
 */
@Injectable()
export class AdsService {
  private readonly logger = new Logger(AdsService.name);
  private readonly frontendUrl: string;

  constructor(
    private readonly supabaseService: SupabaseService,
    private readonly wompi: WompiService,
    private readonly pushService: PushNotificationsService,
    configService: ConfigService,
  ) {
    this.frontendUrl = configService.get<string>('PAYMENTS_FRONTEND_URL') ?? 'https://sercom-frontend.vercel.app';
  }

  private get db() {
    return this.supabaseService.sbRaw;
  }

  async getMine(workerId: string) {
    await this.syncPending(workerId);
    const { data: active } = await this.db
      .from('worker_boosts')
      .select('period_end')
      .eq('worker_id', workerId)
      .eq('status', 'active')
      .gt('period_end', new Date().toISOString())
      .order('period_end', { ascending: false })
      .limit(1)
      .maybeSingle();
    const prices = getBoostPrices();
    return {
      is_featured: !!active,
      period_end: active?.period_end ?? null,
      packages: [
        { days: 7, price: prices[7] },
        { days: 30, price: prices[30] },
      ],
    };
  }

  async checkout(workerId: string, dto: BuyBoostDto) {
    if (!this.wompi.isConfigured) throw new ServiceUnavailableException('Los pagos no están configurados');
    const { data: profile } = await this.db
      .from('profiles')
      .select('email, full_name, roles, active_role')
      .eq('id', workerId)
      .maybeSingle();
    const roles: string[] = Array.isArray(profile?.roles) ? profile.roles : [];
    if (!roles.includes('worker') && profile?.active_role !== 'worker') {
      throw new ForbiddenException('Los anuncios destacados son para profesionales');
    }

    const amount = getBoostPrices()[dto.days];
    const { data: row, error } = await this.db
      .from('worker_boosts')
      .insert({ worker_id: workerId, days: dto.days, amount })
      .select('id')
      .single();
    if (error) throw new InternalServerErrorException(error.message);

    const reference = `${AD_REFERENCE_PREFIX}${row.id}_${Date.now().toString(36)}`;
    const checkoutUrl = this.wompi.buildCheckoutUrl({
      reference,
      amountInCents: amount * 100,
      currency: 'COP',
      redirectUrl: this.frontendUrl,
      customerEmail: profile?.email,
      customerName: profile?.full_name,
    });
    await this.db.from('worker_boosts').update({ checkout_reference: reference }).eq('id', row.id);
    return { checkout_url: checkoutUrl, amount, days: dto.days };
  }

  /** Profesionales destacados vigentes (carrusel del inicio del cliente). */
  async featured() {
    const { data: boosts } = await this.db
      .from('worker_boosts')
      .select('worker_id')
      .eq('status', 'active')
      .gt('period_end', new Date().toISOString());
    const ids = [...new Set((boosts ?? []).map((b: any) => b.worker_id))];
    if (!ids.length) return { workers: [] };

    const { data: workers } = await this.db
      .from('profiles')
      .select('id, full_name, profile_image_url, rating_avg, rating_count, city, bio')
      .in('id', ids)
      .eq('is_published', true)
      .limit(12);
    return { workers: workers ?? [] };
  }

  async applyWompiTransaction(tx: WompiTransaction) {
    const id = tx.reference.slice(AD_REFERENCE_PREFIX.length).split('_')[0];
    const { data: row } = await this.db.from('worker_boosts').select('*').eq('id', id).maybeSingle();
    if (row) await this.apply(row, tx);
  }

  private async apply(row: any, tx: WompiTransaction) {
    if (row.status !== 'pending') return;
    const now = new Date();
    if (tx.status === 'APPROVED') {
      if (tx.amount_in_cents !== Math.round(Number(row.amount) * 100)) {
        this.logger.error(`Anuncio ${row.id}: monto ${tx.amount_in_cents} no coincide`);
        return;
      }
      const { data: current } = await this.db
        .from('worker_boosts')
        .select('period_end')
        .eq('worker_id', row.worker_id)
        .eq('status', 'active')
        .gt('period_end', now.toISOString())
        .order('period_end', { ascending: false })
        .limit(1)
        .maybeSingle();
      const start = current?.period_end ? new Date(current.period_end) : now;
      const end = new Date(start.getTime() + row.days * 86400000);
      const { data: activated } = await this.db
        .from('worker_boosts')
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
      if (activated) {
        await this.pushService.sendToUser(row.worker_id, {
          title: '¡Tu perfil está destacado!',
          body: `Durante ${row.days} días apareces primero ante los clientes.`,
          data: { type: 'boost_active' },
        });
      }
      return;
    }
    if (['DECLINED', 'ERROR', 'VOIDED'].includes(tx.status)) {
      await this.db
        .from('worker_boosts')
        .update({ status: 'failed', provider_transaction_id: tx.id, provider_status: tx.status })
        .eq('id', row.id)
        .eq('status', 'pending');
    }
  }

  private async syncPending(workerId: string) {
    if (!this.wompi.isConfigured) return;
    const { data: pending } = await this.db
      .from('worker_boosts')
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
        this.logger.warn(`Sincronizar anuncio ${row.id}: ${(err as Error).message}`);
      }
    }
  }
}
