import {
  BadRequestException,
  Injectable,
  InternalServerErrorException,
} from '@nestjs/common';
import { SupabaseService } from '../supabase/supabase.service';

const PAID_STATUSES = ['held', 'released', 'disbursed'];

export interface CouponRow {
  id: string;
  code: string;
  description: string | null;
  discount_type: 'percent' | 'fixed';
  discount_value: number;
  max_discount: number | null;
  min_amount: number;
  first_service_only: boolean;
  category_id: string | null;
  starts_at: string | null;
  ends_at: string | null;
  max_redemptions: number | null;
  max_per_user: number;
  active: boolean;
}

/**
 * Cupones de descuento para clientes. El descuento sale de la comisión de
 * SerCom (el profesional recibe lo mismo). Un uso cuenta cuando el pago queda
 * en custodia, así un pago abandonado no gasta el cupón.
 */
@Injectable()
export class CouponsService {
  constructor(private readonly supabaseService: SupabaseService) {}

  private get db() {
    return this.supabaseService.sbRaw;
  }

  static normalize(code: string) {
    return code.trim().toUpperCase().replace(/\s+/g, '');
  }

  /** Valida el cupón para este cliente/servicio y devuelve el descuento. */
  async evaluate(params: {
    code: string;
    clientId: string;
    categoryId: string | null;
    baseAmount: number;
    paymentId: string;
  }): Promise<{ coupon: CouponRow; discount: number }> {
    const code = CouponsService.normalize(params.code);
    const { data: coupon, error } = await this.db
      .from('coupons')
      .select('*')
      .eq('code', code)
      .maybeSingle();
    if (error) throw new InternalServerErrorException(error.message);

    const invalid = (msg: string) => new BadRequestException(msg);
    if (!coupon || !coupon.active) throw invalid('Este cupón no existe o ya no está activo');

    const now = Date.now();
    if (coupon.starts_at && new Date(coupon.starts_at).getTime() > now) {
      throw invalid('Este cupón todavía no está disponible');
    }
    if (coupon.ends_at && new Date(coupon.ends_at).getTime() < now) {
      throw invalid('Este cupón ya venció');
    }
    if (coupon.category_id && coupon.category_id !== params.categoryId) {
      throw invalid('Este cupón no aplica para esta categoría de servicio');
    }
    if (params.baseAmount < Number(coupon.min_amount ?? 0)) {
      throw invalid(
        `Este cupón aplica para servicios desde $${Number(coupon.min_amount).toLocaleString('es-CO')}`,
      );
    }

    const paidByClient = await this.countPaid({ clientId: params.clientId }, params.paymentId);
    if (coupon.first_service_only && paidByClient > 0) {
      throw invalid('Este cupón es solo para tu primer servicio');
    }
    if (
      (await this.countPaid({ clientId: params.clientId, code }, params.paymentId)) >=
      (coupon.max_per_user ?? 1)
    ) {
      throw invalid('Ya usaste este cupón');
    }
    if (
      coupon.max_redemptions != null &&
      (await this.countPaid({ code }, params.paymentId)) >= coupon.max_redemptions
    ) {
      throw invalid('Este cupón ya alcanzó su límite de usos');
    }

    let discount =
      coupon.discount_type === 'percent'
        ? Math.round((params.baseAmount * Number(coupon.discount_value)) / 100)
        : Math.round(Number(coupon.discount_value));
    if (coupon.max_discount != null) {
      discount = Math.min(discount, Math.round(Number(coupon.max_discount)));
    }
    return { coupon, discount };
  }

  private async countPaid(
    filter: { clientId?: string; code?: string },
    excludePaymentId: string,
  ): Promise<number> {
    let q = this.db
      .from('payments')
      .select('id', { count: 'exact', head: true })
      .in('status', PAID_STATUSES)
      .neq('id', excludePaymentId);
    if (filter.clientId) q = q.eq('client_id', filter.clientId);
    if (filter.code) q = q.eq('coupon_code', filter.code);
    const { count, error } = await q;
    if (error) throw new InternalServerErrorException(error.message);
    return count ?? 0;
  }
}
