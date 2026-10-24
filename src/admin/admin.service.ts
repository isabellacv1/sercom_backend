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
