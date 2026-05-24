import {
  BadRequestException,
  Injectable,
  InternalServerErrorException,
  Logger,
  NotFoundException,
  UnauthorizedException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { SupabaseService } from '../supabase/supabase.service';

export interface WorkerMpAccount {
  id: string;
  worker_id: string;
  mp_user_id: string;
  mp_access_token: string;
  mp_refresh_token: string | null;
  token_expires_at: string | null;
  account_status: 'active' | 'expired' | 'revoked';
  mp_email: string | null;
  mp_nickname: string | null;
  created_at: string;
  updated_at: string;
}

interface MpTokenResponse {
  access_token: string;
  refresh_token: string;
  expires_in: number;
  user_id: number;
  scope: string;
  token_type: string;
}

@Injectable()
export class MpOAuthService {
  private readonly logger = new Logger(MpOAuthService.name);

  private readonly clientId: string;
  private readonly clientSecret: string;
  private readonly redirectUri: string;
  private readonly frontendUrl: string;

  // CSRF state store — in production con múltiples instancias, usar Redis.
  private readonly pendingStates = new Map<string, { workerId: string; expiresAt: number }>();

  constructor(
    private readonly configService: ConfigService,
    private readonly supabaseService: SupabaseService,
  ) {
    this.clientId = configService.get<string>('MP_CLIENT_ID') ?? '';
    this.clientSecret = configService.get<string>('MP_CLIENT_SECRET') ?? '';
    this.redirectUri = configService.get<string>('MP_REDIRECT_URI') ?? '';
    this.frontendUrl = configService.get<string>('MP_FRONTEND_URL') ?? '';

    if (!this.clientId || !this.clientSecret) {
      this.logger.warn('MP_CLIENT_ID o MP_CLIENT_SECRET no configurados. OAuth no disponible.');
    }
  }

  private get db() {
    return this.supabaseService.sbRaw;
  }

  // ─── Generar URL de autorización ───────────────────────────────────────────

  generateAuthorizeUrl(workerId: string): string {
    if (!this.clientId || !this.redirectUri) {
      throw new BadRequestException('OAuth de Mercado Pago no configurado en el servidor.');
    }

    // Limpiar estados expirados
    for (const [key, val] of this.pendingStates.entries()) {
      if (val.expiresAt < Date.now()) this.pendingStates.delete(key);
    }

    const state = crypto.randomUUID();
    this.pendingStates.set(state, {
      workerId,
      expiresAt: Date.now() + 10 * 60 * 1000, // 10 min TTL
    });

    const params = new URLSearchParams({
      client_id: this.clientId,
      response_type: 'code',
      platform_id: 'mp',
      state,
      redirect_uri: this.redirectUri,
    });

    return `https://auth.mercadopago.com/authorization?${params.toString()}`;
  }

  // ─── Callback OAuth: intercambiar código por tokens ────────────────────────

  async handleCallback(code: string, state: string): Promise<{ workerId: string; redirectUrl: string }> {
    const pending = this.pendingStates.get(state);

    if (!pending || pending.expiresAt < Date.now()) {
      throw new UnauthorizedException('Estado OAuth inválido o expirado. Inicia el proceso nuevamente.');
    }

    this.pendingStates.delete(state);
    const { workerId } = pending;

    const tokenData = await this.exchangeCodeForTokens(code);
    await this.upsertWorkerAccount(workerId, tokenData);

    this.logger.log(`Cuenta MP vinculada para worker ${workerId} (MP user: ${tokenData.user_id})`);

    const redirectUrl = `${this.frontendUrl}/oauth/success?worker_id=${workerId}`;
    return { workerId, redirectUrl };
  }

  // ─── Estado de conexión ─────────────────────────────────────────────────────

  async getConnectionStatus(workerId: string) {
    const account = await this.getWorkerAccount(workerId);

    if (!account) {
      return { connected: false, mp_user_id: null, mp_email: null, account_status: null };
    }

    // Refrescar token si está por expirar (< 7 días)
    if (account.token_expires_at) {
      const expiresAt = new Date(account.token_expires_at).getTime();
      const sevenDays = 7 * 24 * 60 * 60 * 1000;
      if (expiresAt - Date.now() < sevenDays) {
        await this.refreshWorkerToken(workerId).catch((err) =>
          this.logger.warn(`No se pudo refrescar token de worker ${workerId}: ${err.message}`),
        );
      }
    }

    return {
      connected: account.account_status === 'active',
      mp_user_id: account.mp_user_id,
      mp_email: account.mp_email,
      mp_nickname: account.mp_nickname,
      account_status: account.account_status,
      connected_since: account.created_at,
    };
  }

  // ─── Obtener cuenta del trabajador ─────────────────────────────────────────

  async getWorkerAccount(workerId: string): Promise<WorkerMpAccount | null> {
    const { data, error } = await this.db
      .from('worker_payment_accounts')
      .select('*')
      .eq('worker_id', workerId)
      .eq('account_status', 'active')
      .maybeSingle();

    if (error) {
      this.logger.error(`Error obteniendo cuenta MP de worker ${workerId}: ${error.message}`);
      return null;
    }

    return data as WorkerMpAccount | null;
  }

  // ─── Desconectar cuenta ─────────────────────────────────────────────────────

  async disconnectWorker(workerId: string): Promise<void> {
    const { error } = await this.db
      .from('worker_payment_accounts')
      .update({ account_status: 'revoked', updated_at: new Date().toISOString() })
      .eq('worker_id', workerId);

    if (error) throw new InternalServerErrorException(error.message);
    this.logger.log(`Cuenta MP desconectada para worker ${workerId}`);
  }

  // ─── Refrescar token ────────────────────────────────────────────────────────

  async refreshWorkerToken(workerId: string): Promise<void> {
    const account = await this.getWorkerAccount(workerId);
    if (!account?.mp_refresh_token) {
      throw new NotFoundException('No hay refresh token disponible. El trabajador debe reconectar su cuenta.');
    }

    const body = new URLSearchParams({
      grant_type: 'refresh_token',
      client_id: this.clientId,
      client_secret: this.clientSecret,
      refresh_token: account.mp_refresh_token,
    });

    const response = await fetch('https://api.mercadopago.com/oauth/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: body.toString(),
    });

    if (!response.ok) {
      const err = (await response.json()) as any;
      throw new InternalServerErrorException(`Error refrescando token: ${err.message ?? response.status}`);
    }

    const tokenData = (await response.json()) as MpTokenResponse;
    await this.upsertWorkerAccount(workerId, tokenData);
  }

  // ─── Helpers privados ───────────────────────────────────────────────────────

  private async exchangeCodeForTokens(code: string): Promise<MpTokenResponse> {
    const body = new URLSearchParams({
      grant_type: 'authorization_code',
      client_id: this.clientId,
      client_secret: this.clientSecret,
      code,
      redirect_uri: this.redirectUri,
    });

    const response = await fetch('https://api.mercadopago.com/oauth/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: body.toString(),
    });

    if (!response.ok) {
      const err = (await response.json()) as any;
      throw new InternalServerErrorException(
        `Error intercambiando código OAuth: ${err.message ?? response.status}`,
      );
    }

    return (await response.json()) as MpTokenResponse;
  }

  private async fetchMpUserInfo(accessToken: string): Promise<{ email?: string; nickname?: string }> {
    try {
      const res = await fetch('https://api.mercadopago.com/v1/account', {
        headers: { Authorization: `Bearer ${accessToken}` },
      });
      if (!res.ok) return {};
      const data = (await res.json()) as any;
      return { email: data.email, nickname: data.nickname };
    } catch {
      return {};
    }
  }

  private async upsertWorkerAccount(workerId: string, tokenData: MpTokenResponse): Promise<void> {
    const userInfo = await this.fetchMpUserInfo(tokenData.access_token);
    const now = new Date().toISOString();
    const expiresAt = new Date(Date.now() + tokenData.expires_in * 1000).toISOString();

    const record = {
      worker_id: workerId,
      mp_user_id: tokenData.user_id.toString(),
      mp_access_token: tokenData.access_token,
      mp_refresh_token: tokenData.refresh_token ?? null,
      token_expires_at: expiresAt,
      account_status: 'active',
      mp_email: userInfo.email ?? null,
      mp_nickname: userInfo.nickname ?? null,
      updated_at: now,
    };

    const { error } = await this.db
      .from('worker_payment_accounts')
      .upsert({ ...record, created_at: now }, { onConflict: 'worker_id' });

    if (error) throw new InternalServerErrorException(`Error guardando cuenta MP: ${error.message}`);
  }
}
