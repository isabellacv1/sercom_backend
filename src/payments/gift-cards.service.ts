import {
  BadRequestException,
  Injectable,
  InternalServerErrorException,
  Logger,
  NotFoundException,
  ServiceUnavailableException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { randomInt } from 'crypto';
import { SupabaseService } from '../supabase/supabase.service';
import { PushNotificationsService } from '../push-notifications/push-notifications.service';
import { WompiService, WompiTransaction } from './wompi.service';
import { CreditsService } from './credits.service';
import { BuyGiftCardDto } from './dto/gift-and-ads.dto';

export const GIFT_REFERENCE_PREFIX = 'gift_';
const CODE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';

export function newGiftCode() {
  const part = () => Array.from({ length: 4 }, () => CODE_ALPHABET[randomInt(CODE_ALPHABET.length)]).join('');
  return `SC-${part()}-${part()}`;
}

/**
 * Tarjetas de regalo: se compran con Wompi y quien recibe el código lo
 * canjea como saldo SERCOM para sus servicios.
 */
@Injectable()
export class GiftCardsService {
  private readonly logger = new Logger(GiftCardsService.name);
  private readonly frontendUrl: string;

  constructor(
    private readonly supabaseService: SupabaseService,
    private readonly wompi: WompiService,
    private readonly credits: CreditsService,
    private readonly pushService: PushNotificationsService,
    configService: ConfigService,
  ) {
    this.frontendUrl = configService.get<string>('PAYMENTS_FRONTEND_URL') ?? 'https://sercom-frontend.vercel.app';
  }

  private get db() {
    return this.supabaseService.sbRaw;
  }

  async checkout(buyerId: string, dto: BuyGiftCardDto) {
    if (!this.wompi.isConfigured) throw new ServiceUnavailableException('Los pagos no están configurados');
    const { data: row, error } = await this.db
      .from('gift_cards')
      .insert({
        buyer_id: buyerId,
        amount: dto.amount,
        recipient_name: dto.recipient_name?.trim() || null,
        message: dto.message?.trim() || null,
      })
      .select('id')
      .single();
    if (error) throw new InternalServerErrorException(error.message);

    const { data: buyer } = await this.db.from('profiles').select('email, full_name').eq('id', buyerId).maybeSingle();
    const reference = `${GIFT_REFERENCE_PREFIX}${row.id}_${Date.now().toString(36)}`;
    const checkoutUrl = this.wompi.buildCheckoutUrl({
      reference,
      amountInCents: dto.amount * 100,
      currency: 'COP',
      redirectUrl: this.frontendUrl,
      customerEmail: buyer?.email,
      customerName: buyer?.full_name,
    });
    await this.db.from('gift_cards').update({ checkout_reference: reference }).eq('id', row.id);
    return { checkout_url: checkoutUrl, gift_card_id: row.id };
  }

  async listMine(buyerId: string) {
    await this.syncPending(buyerId);
    const { data, error } = await this.db
      .from('gift_cards')
      .select('id, amount, code, recipient_name, message, status, paid_at, redeemed_at, created_at')
      .eq('buyer_id', buyerId)
      .in('status', ['paid', 'redeemed'])
      .order('created_at', { ascending: false });
    if (error) throw new InternalServerErrorException(error.message);
    return { gift_cards: data ?? [] };
  }

  async redeem(userId: string, rawCode: string) {
    const code = rawCode.trim().toUpperCase();
    const { data: card } = await this.db.from('gift_cards').select('*').eq('code', code).maybeSingle();
    if (!card) throw new NotFoundException('Este código de tarjeta no existe');
    if (card.status === 'redeemed') throw new BadRequestException('Esta tarjeta ya fue canjeada');
    if (card.status !== 'paid') throw new BadRequestException('Esta tarjeta todavía no está activa');

    // Marcar canjeada primero (una sola vez aunque se intente dos veces).
    const { data: claimed } = await this.db
      .from('gift_cards')
      .update({ status: 'redeemed', redeemed_by: userId, redeemed_at: new Date().toISOString() })
      .eq('id', card.id)
      .eq('status', 'paid')
      .select('id')
      .maybeSingle();
    if (!claimed) throw new BadRequestException('Esta tarjeta ya fue canjeada');

    await this.credits.add(userId, Number(card.amount), 'Tarjeta de regalo', card.id);
    if (card.buyer_id !== userId) {
      await this.pushService.sendToUser(card.buyer_id, {
        title: 'Canjearon tu tarjeta de regalo',
        body: `${card.recipient_name ?? 'Tu regalo'} ya tiene ${this.cop(card.amount)} de saldo SERCOM.`,
        data: { type: 'gift_redeemed' },
      });
    }
    return { message: `¡Listo! Sumamos ${this.cop(card.amount)} a tu saldo SERCOM.`, amount: Number(card.amount) };
  }

  async applyWompiTransaction(tx: WompiTransaction) {
    const id = tx.reference.slice(GIFT_REFERENCE_PREFIX.length).split('_')[0];
    const { data: row } = await this.db.from('gift_cards').select('*').eq('id', id).maybeSingle();
    if (row) await this.apply(row, tx);
  }

  private async apply(row: any, tx: WompiTransaction) {
    if (row.status !== 'pending') return;
    const now = new Date().toISOString();
    if (tx.status === 'APPROVED') {
      if (tx.amount_in_cents !== Math.round(Number(row.amount) * 100)) {
        this.logger.error(`Tarjeta ${row.id}: monto ${tx.amount_in_cents} no coincide`);
        return;
      }
      for (let attempt = 0; attempt < 5; attempt++) {
        const { data, error } = await this.db
          .from('gift_cards')
          .update({
            status: 'paid',
            code: newGiftCode(),
            paid_at: now,
            provider_transaction_id: tx.id,
            provider_status: tx.status,
            updated_at: now,
          })
          .eq('id', row.id)
          .eq('status', 'pending')
          .select('code')
          .maybeSingle();
        if (!error) {
          if (data) {
            await this.pushService.sendToUser(row.buyer_id, {
              title: 'Tu tarjeta de regalo está lista',
              body: `Código ${data.code} por ${this.cop(row.amount)}. Compártelo desde la app.`,
              data: { type: 'gift_paid' },
            });
          }
          return;
        }
        // Código repetido (muy improbable): se reintenta con otro.
      }
      return;
    }
    if (['DECLINED', 'ERROR', 'VOIDED'].includes(tx.status)) {
      await this.db
        .from('gift_cards')
        .update({ status: 'failed', provider_transaction_id: tx.id, provider_status: tx.status, updated_at: now })
        .eq('id', row.id)
        .eq('status', 'pending');
    }
  }

  private async syncPending(buyerId: string) {
    if (!this.wompi.isConfigured) return;
    const { data: pending } = await this.db
      .from('gift_cards')
      .select('*')
      .eq('buyer_id', buyerId)
      .eq('status', 'pending')
      .not('checkout_reference', 'is', null)
      .gt('created_at', new Date(Date.now() - 2 * 86400000).toISOString());
    for (const row of pending ?? []) {
      try {
        const txs = await this.wompi.findTransactionsByReference(row.checkout_reference);
        const tx = txs.find((t) => t.status === 'APPROVED') ?? txs[0];
        if (tx) await this.apply(row, tx);
      } catch (err) {
        this.logger.warn(`Sincronizar tarjeta ${row.id}: ${(err as Error).message}`);
      }
    }
  }

  private cop(amount: number | string) {
    return `$${Number(amount).toLocaleString('es-CO')}`;
  }
}
