import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

export interface PayoutResult {
  success: boolean;
  payoutStatus: 'completed' | 'pending_manual' | 'failed';
  externalId?: string;
  method?: 'marketplace_split' | 'account_transfer' | 'disbursements_api' | 'manual';
  error?: string;
}

@Injectable()
export class PayoutService {
  private readonly logger = new Logger(PayoutService.name);
  private readonly accessToken: string;

  constructor(private readonly configService: ConfigService) {
    this.accessToken = configService.get<string>('MP_ACCESS_TOKEN') ?? '';
  }

  // ─── Transferencia entre cuentas MP (plataforma → trabajador) ────────────
  // Requiere que el trabajador tenga mp_user_id registrado.
  // No requiere certificación de marketplace — usa el saldo de la cuenta SerCom.

  async transferToWorker(params: {
    referenceId: string;
    recipientMpUserId: string;
    amount: number;
    description: string;
  }): Promise<PayoutResult> {
    if (!this.accessToken) {
      return { success: false, payoutStatus: 'failed', error: 'MP_ACCESS_TOKEN no configurado' };
    }

    if (!params.recipientMpUserId) {
      this.logger.warn(`Transfer ${params.referenceId}: sin mp_user_id. Marcando como pendiente manual.`);
      return { success: false, payoutStatus: 'pending_manual', method: 'manual', error: 'Trabajador sin cuenta MP vinculada' };
    }

    try {
      const response = await fetch('https://api.mercadopago.com/v1/account/transfer', {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${this.accessToken}`,
          'Content-Type': 'application/json',
          'X-Idempotency-Key': `transfer-${params.referenceId}`,
        },
        body: JSON.stringify({
          user_id: params.recipientMpUserId,
          amount: params.amount,
          description: params.description,
        }),
      });

      if (response.ok) {
        const data = (await response.json()) as any;
        this.logger.log(`Transfer ${params.referenceId} exitosa. ID: ${data.id}`);
        return { success: true, payoutStatus: 'completed', method: 'account_transfer', externalId: data.id?.toString() };
      }

      const errorData = (await response.json()) as any;
      const errorMsg: string = errorData?.message ?? `HTTP ${response.status}`;

      // El endpoint de transferencia puede no estar disponible en sandbox
      if (response.status === 400 && errorMsg.includes('insufficient')) {
        return { success: false, payoutStatus: 'failed', error: 'Saldo insuficiente en la cuenta SerCom' };
      }

      if (response.status === 403 || response.status === 404) {
        this.logger.warn(`Account transfer no disponible (${response.status}). Intentando Disbursements API...`);
        return this.disbursementsApiFallback(params);
      }

      return { success: false, payoutStatus: 'failed', error: errorMsg };
    } catch (err: any) {
      this.logger.error(`Error de red en transfer ${params.referenceId}: ${err.message}`);
      return { success: false, payoutStatus: 'failed', error: err.message };
    }
  }

  // ─── Split de marketplace: cuando el pago se hizo con el token del worker ──
  // En este caso el dinero YA está en la cuenta del trabajador al aprobarse el pago.
  // Solo necesitamos registrar el estado como disbursed.

  marketplaceSplitAlreadyExecuted(referenceId: string): PayoutResult {
    this.logger.log(`Pago ${referenceId} fue split de marketplace. Trabajador ya recibió su pago.`);
    return { success: true, payoutStatus: 'completed', method: 'marketplace_split' };
  }

  // ─── Fallback: Disbursements API (requiere certificación de marketplace) ──

  private async disbursementsApiFallback(params: {
    referenceId: string;
    recipientMpUserId: string;
    amount: number;
    description: string;
  }): Promise<PayoutResult> {
    try {
      const response = await fetch('https://api.mercadopago.com/v1/disbursements', {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${this.accessToken}`,
          'Content-Type': 'application/json',
          'X-Idempotency-Key': `disbursement-${params.referenceId}`,
        },
        body: JSON.stringify({
          transaction_amount: params.amount,
          description: params.description,
          payment_method_id: 'account_money',
          collector: { id: params.recipientMpUserId },
          external_reference: params.referenceId,
        }),
      });

      if (response.ok) {
        const data = (await response.json()) as any;
        return { success: true, payoutStatus: 'completed', method: 'disbursements_api', externalId: data.id?.toString() };
      }

      const err = (await response.json()) as any;
      const msg: string = err?.message ?? `HTTP ${response.status}`;

      if (response.status === 403) {
        this.logger.warn(`Disbursements API requiere certificación de marketplace. Marcando como pendiente manual.`);
        return { success: false, payoutStatus: 'pending_manual', method: 'manual', error: msg };
      }

      return { success: false, payoutStatus: 'failed', error: msg };
    } catch (err: any) {
      return { success: false, payoutStatus: 'pending_manual', method: 'manual', error: err.message };
    }
  }
}
