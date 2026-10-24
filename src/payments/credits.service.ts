import { Injectable, InternalServerErrorException } from '@nestjs/common';
import { SupabaseService } from '../supabase/supabase.service';

/**
 * Saldo SERCOM: movimientos a favor (+, p. ej. por referidos) y usos (−, al
 * pagar un servicio). El saldo es la suma de los movimientos.
 */
@Injectable()
export class CreditsService {
  constructor(private readonly supabaseService: SupabaseService) {}

  private get db() {
    return this.supabaseService.sbRaw;
  }

  async balance(userId: string): Promise<number> {
    const { data, error } = await this.db
      .from('user_credits')
      .select('amount')
      .eq('user_id', userId);
    if (error) throw new InternalServerErrorException(error.message);
    return Math.max(
      0,
      (data ?? []).reduce((s: number, r: any) => s + Number(r.amount ?? 0), 0),
    );
  }

  async getMine(userId: string) {
    const { data, error } = await this.db
      .from('user_credits')
      .select('amount, reason, created_at')
      .eq('user_id', userId)
      .order('created_at', { ascending: false })
      .limit(50);
    if (error) throw new InternalServerErrorException(error.message);
    return { balance: await this.balance(userId), movements: data ?? [] };
  }

  async add(userId: string, amount: number, reason: string, referenceId?: string) {
    const { error } = await this.db.from('user_credits').insert({
      user_id: userId,
      amount,
      reason,
      reference_id: referenceId ?? null,
    });
    if (error) throw new InternalServerErrorException(error.message);
  }

  /** Descuenta el saldo usado en un pago (idempotente por pago). */
  async consumeForPayment(userId: string, paymentId: string, amount: number) {
    if (amount <= 0) return;
    const { data: existing } = await this.db
      .from('user_credits')
      .select('id')
      .eq('user_id', userId)
      .eq('reference_id', paymentId)
      .lt('amount', 0)
      .maybeSingle();
    if (existing) return;
    await this.add(userId, -amount, 'Usado en un servicio', paymentId);
  }
}
