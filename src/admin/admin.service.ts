import { PaidPaymentRow, paymentRevenue, repeatRate, weekly } from './metrics';
import {
  ConflictException,
  Injectable,
  InternalServerErrorException,
  NotFoundException,
} from '@nestjs/common';
import { SupabaseService } from '../supabase/supabase.service';
import { CreateBannerDto, CreateCouponDto } from './dto/coupon.dto';

const CREDENTIALS_BUCKET = 'worker-credentials';

/** Datos y acciones del panel de administración de SERCOM. */
@Injectable()
export class AdminService {
  constructor(private readonly supabaseService: SupabaseService) {}

  private get db() {
    return this.supabaseService.sbRaw;
  }

  async overview() {
    const now = new Date().toISOString();
    const count = async (table: string, apply: (q: any) => any) => {
      const { count } = await apply(this.db.from(table).select('id', { count: 'exact', head: true }));
      return count ?? 0;
    };
    const sum = async (table: string, column: string, apply: (q: any) => any) => {
      const { data } = await apply(this.db.from(table).select(column));
      return (data ?? []).reduce((s: number, r: any) => s + Number(r[column] ?? 0), 0);
    };

    const [
      heldAmount,
      pendingPayouts,
      pendingTips,
      openTickets,
      highTickets,
      pendingCredentials,
      activePro,
      activePlus,
      paidServices,
      revenue,
    ] = await Promise.all([
      sum('payments', 'amount_total', (q) => q.eq('status', 'held')),
      sum('payments', 'worker_amount', (q) => q.eq('status', 'released').eq('payout_status', 'pending_manual')),
      sum('service_tips', 'amount', (q) => q.eq('status', 'paid').eq('payout_status', 'pending_manual')),
      count('support_tickets', (q) => q.neq('status', 'resolved')),
      count('support_tickets', (q) => q.neq('status', 'resolved').eq('priority', 'high')),
      count('worker_credentials', (q) => q.eq('status', 'pending')),
      count('worker_memberships', (q) => q.eq('plan', 'pro').eq('status', 'active').gt('period_end', now)),
      count('worker_memberships', (q) => q.eq('plan', 'plus').eq('status', 'active').gt('period_end', now)),
      count('payments', (q) => q.in('status', ['held', 'released', 'disbursed'])),
      sum('payments', 'commission_amount', (q) => q.in('status', ['held', 'released', 'disbursed'])),
    ]);

    return {
      held_amount: heldAmount,
      pending_payout_amount: pendingPayouts + pendingTips,
      open_tickets: openTickets,
      high_priority_tickets: highTickets,
      pending_credentials: pendingCredentials,
      active_pro: activePro,
      active_plus: activePlus,
      paid_services: paidServices,
      commission_revenue: revenue,
    };
  }

  /** Métricas del MVP: ingresos por canal, embudo, recurrencia y unidad. */
  async metrics() {
    const paidStatuses = ['held', 'released', 'disbursed'];
    const since = new Date(Date.now() - 8 * 7 * 86400000).toISOString();
    const [payments, memberships, boosts, gifts, tips, services, proposals, photoQuotes] = await Promise.all([
      this.db
        .from('payments')
        .select(
          'client_id, worker_id, amount_total, amount_before_discount, commission_amount, commission_before_discount, worker_amount, service_price, client_fee_amount, worker_commission_amount, surcharge_amount, warranty_amount, coupon_discount, credit_applied, payout_fee, created_at',
        )
        .in('status', paidStatuses),
      this.db.from('worker_memberships').select('plan, amount, period_end').eq('status', 'active'),
      this.db.from('worker_boosts').select('amount').eq('status', 'active'),
      this.db.from('gift_cards').select('amount, status').in('status', ['paid', 'redeemed']),
      this.db.from('service_tips').select('amount, payout_fee').eq('status', 'paid'),
      this.db.from('services').select('id, status, created_at'),
      this.db.from('proposals').select('service_id'),
      this.db.from('photo_quotes').select('id', { count: 'exact', head: true }),
    ]);

    const paid = (payments.data ?? []) as PaidPaymentRow[];
    const revenue = paymentRevenue(paid);
    const now = new Date().toISOString();
    const sumBy = (rows: any[] | null, filter: (r: any) => boolean = () => true) =>
      (rows ?? []).filter(filter).reduce((s, r) => s + Number(r.amount ?? 0), 0);
    const mem = memberships.data ?? [];
    const tipFees = (tips.data ?? []).reduce((s: number, t: any) => s + Number(t.payout_fee ?? 0), 0);

    const channels = [
      { key: 'client_fee', label: 'Tarifa de servicio (cliente)', amount: revenue.client_fees },
      { key: 'worker_commission', label: 'Comisión del profesional', amount: revenue.worker_commissions },
      { key: 'surcharge', label: 'Tarifa dinámica', amount: revenue.surcharge_share },
      { key: 'warranty', label: 'Garantía extendida', amount: revenue.warranty },
      { key: 'instant_payout', label: 'Cobro inmediato', amount: revenue.instant_fees + tipFees },
      { key: 'pro', label: 'SERCOM Pro', amount: sumBy(mem, (m) => m.plan === 'pro') },
      { key: 'plus', label: 'SERCOM Plus', amount: sumBy(mem, (m) => m.plan === 'plus') },
      { key: 'care', label: 'Hogar Tranquilo', amount: sumBy(mem, (m) => m.plan === 'care') },
      { key: 'ads', label: 'SERCOM Ads', amount: sumBy(boosts.data) },
    ];
    const gross = channels.reduce((s, c) => s + c.amount, 0);

    const allServices = services.data ?? [];
    const withProposal = new Set((proposals.data ?? []).map((p: any) => p.service_id));
    const repeat = repeatRate(paid);

    return {
      revenue: {
        gross,
        discounts: revenue.discounts,
        net: gross - revenue.discounts,
        channels,
      },
      gmv: revenue.gmv,
      paid_services: revenue.count,
      per_service: revenue.per_service,
      funnel: {
        requested: allServices.length,
        with_proposal: allServices.filter((s: any) => withProposal.has(s.id)).length,
        paid: revenue.count,
        completed: allServices.filter((s: any) => s.status === 'completed').length,
      },
      clients: repeat,
      active_workers: new Set(paid.map((p) => p.worker_id)).size,
      active_memberships: {
        pro: mem.filter((m: any) => m.plan === 'pro' && m.period_end > now).length,
        plus: mem.filter((m: any) => m.plan === 'plus' && m.period_end > now).length,
        care: mem.filter((m: any) => m.plan === 'care' && m.period_end > now).length,
      },
      gift_cards_sold: sumBy(gifts.data),
      tips_total: sumBy(tips.data),
      photo_quotes: photoQuotes.count ?? 0,
      weekly: {
        requested: weekly(allServices.filter((s: any) => s.created_at >= since).map((s: any) => s.created_at)),
        paid: weekly(paid.filter((p) => p.created_at >= since).map((p) => p.created_at)),
      },
    };
  }

  async credentials(status = 'pending') {
    const { data, error } = await this.db
      .from('worker_credentials')
      .select('id, worker_id, title, institution, issued_at, expires_at, status, review_note, file_path, created_at, worker:worker_id(full_name, email)')
      .eq('status', status)
      .order('created_at', { ascending: true });
    if (error) throw new InternalServerErrorException(error.message);
    const rows = data ?? [];
    if (!rows.length) return { credentials: [] };

    const { data: signed } = await this.supabaseService.client.storage
      .from(CREDENTIALS_BUCKET)
      .createSignedUrls(rows.map((r: any) => r.file_path), 3600);
    return {
      credentials: rows.map(({ file_path, ...r }: any, i: number) => ({
        ...r,
        file_url: signed?.[i]?.signedUrl ?? null,
      })),
    };
  }

  // ─── Cupones ─────────────────────────────────────────────────────────

  async coupons() {
    const { data, error } = await this.db
      .from('coupons')
      .select('*')
      .order('created_at', { ascending: false });
    if (error) throw new InternalServerErrorException(error.message);

    // Usos = pagos en custodia o liberados con ese cupón.
    const { data: used } = await this.db
      .from('payments')
      .select('coupon_code')
      .not('coupon_code', 'is', null)
      .in('status', ['held', 'released', 'disbursed']);
    const uses = new Map<string, number>();
    for (const p of used ?? []) uses.set(p.coupon_code, (uses.get(p.coupon_code) ?? 0) + 1);

    return { coupons: (data ?? []).map((c: any) => ({ ...c, uses: uses.get(c.code) ?? 0 })) };
  }

  async createCoupon(dto: CreateCouponDto) {
    const code = dto.code.trim().toUpperCase();
    if (dto.discount_type === 'percent' && dto.discount_value > 100) {
      throw new ConflictException('El porcentaje no puede ser mayor a 100');
    }
    const { data, error } = await this.db
      .from('coupons')
      .insert({
        code,
        description: dto.description ?? null,
        discount_type: dto.discount_type,
        discount_value: dto.discount_value,
        max_discount: dto.max_discount ?? null,
        min_amount: dto.min_amount ?? 0,
        first_service_only: dto.first_service_only ?? false,
        category_id: dto.category_id ?? null,
        ends_at: dto.ends_at ?? null,
        max_redemptions: dto.max_redemptions ?? null,
      })
      .select('*')
      .single();
    if (error) {
      if (error.code === '23505') throw new ConflictException('Ya existe un cupón con ese código');
      throw new InternalServerErrorException(error.message);
    }
    return { coupon: data };
  }

  async setCouponActive(id: string, active: boolean) {
    return this.setActive('coupons', id, active, 'Cupón no encontrado');
  }

  // ─── Banners ─────────────────────────────────────────────────────────

  async banners() {
    const { data, error } = await this.db
      .from('promo_banners')
      .select('*')
      .order('sort_order', { ascending: true });
    if (error) throw new InternalServerErrorException(error.message);
    return { banners: data ?? [] };
  }

  async createBanner(dto: CreateBannerDto) {
    const { data, error } = await this.db
      .from('promo_banners')
      .insert({
        title: dto.title.trim(),
        subtitle: dto.subtitle ?? null,
        cta_label: dto.cta_label.trim(),
        action_type: dto.action_type,
        action_value: dto.action_value ?? null,
        audience: dto.audience ?? 'client',
        icon: dto.icon ?? 'local_offer',
        ends_at: dto.ends_at ?? null,
        sort_order: dto.sort_order ?? 0,
      })
      .select('*')
      .single();
    if (error) throw new InternalServerErrorException(error.message);
    return { banner: data };
  }

  async setBannerActive(id: string, active: boolean) {
    return this.setActive('promo_banners', id, active, 'Banner no encontrado');
  }

  private async setActive(table: string, id: string, active: boolean, notFound: string) {
    const { data, error } = await this.db
      .from(table)
      .update({ active })
      .eq('id', id)
      .select('id, active')
      .maybeSingle();
    if (error) throw new InternalServerErrorException(error.message);
    if (!data) throw new NotFoundException(notFound);
    return data;
  }
}
