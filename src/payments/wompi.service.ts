import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createHash, timingSafeEqual } from 'crypto';

export type WompiTransactionStatus =
  | 'PENDING'
  | 'APPROVED'
  | 'DECLINED'
  | 'VOIDED'
  | 'ERROR';

export interface WompiTransaction {
  id: string;
  reference: string;
  status: WompiTransactionStatus;
  status_message?: string | null;
  amount_in_cents: number;
  currency: string;
  payment_method_type?: string | null;
  created_at?: string;
  finalized_at?: string | null;
}

export interface WompiEvent {
  event: string;
  data: { transaction?: WompiTransaction } & Record<string, any>;
  environment?: string;
  signature?: { properties?: string[]; checksum?: string };
  timestamp?: number;
  sent_at?: string;
}

/**
 * Cliente mínimo de Wompi (Bancolombia).
 *
 * - Web Checkout: URL firmada con el secreto de integridad; no requiere
 *   llamada previa a la API.
 * - Eventos: el webhook se valida con el secreto de eventos y además se
 *   reconsulta la transacción en la API antes de cambiar estados.
 *
 * El ambiente (sandbox / producción) se deduce del prefijo de las llaves
 * (`pub_test_` / `pub_prod_`).
 */
@Injectable()
export class WompiService {
  private readonly logger = new Logger(WompiService.name);

  private readonly publicKey: string;
  private readonly privateKey: string;
  private readonly integritySecret: string;
  private readonly eventsSecret: string;
  readonly apiUrl: string;
  readonly isSandbox: boolean;

  static readonly CHECKOUT_URL = 'https://checkout.wompi.co/p/';

  constructor(configService: ConfigService) {
    this.publicKey = configService.get<string>('WOMPI_PUBLIC_KEY') ?? '';
    this.privateKey = configService.get<string>('WOMPI_PRIVATE_KEY') ?? '';
    this.integritySecret =
      configService.get<string>('WOMPI_INTEGRITY_SECRET') ?? '';
    this.eventsSecret = configService.get<string>('WOMPI_EVENTS_SECRET') ?? '';

    this.isSandbox = !this.publicKey.startsWith('pub_prod_');
    this.apiUrl = this.isSandbox
      ? 'https://sandbox.wompi.co/v1'
      : 'https://production.wompi.co/v1';

    if (!this.isConfigured) {
      this.logger.error(
        'Wompi no configurado (WOMPI_PUBLIC_KEY, WOMPI_PRIVATE_KEY, WOMPI_INTEGRITY_SECRET). Los pagos no funcionarán.',
      );
    }
    if (!this.eventsSecret) {
      this.logger.warn(
        'WOMPI_EVENTS_SECRET no configurado: los webhooks se aceptan solo tras reconsultar la transacción en la API.',
      );
    }
  }

  get isConfigured(): boolean {
    return !!(this.publicKey && this.privateKey && this.integritySecret);
  }

  // ─── Web Checkout ──────────────────────────────────────────────────────────

  buildCheckoutUrl(params: {
    reference: string;
    amountInCents: number;
    currency: string;
    redirectUrl: string;
    customerEmail?: string | null;
    customerName?: string | null;
  }): string {
    const signature = createHash('sha256')
      .update(
        `${params.reference}${params.amountInCents}${params.currency}${this.integritySecret}`,
      )
      .digest('hex');

    const query = new URLSearchParams({
      'public-key': this.publicKey,
      currency: params.currency,
      'amount-in-cents': String(params.amountInCents),
      reference: params.reference,
      'signature:integrity': signature,
      'redirect-url': params.redirectUrl,
    });
    if (params.customerEmail) {
      query.set('customer-data:email', params.customerEmail);
    }
    if (params.customerName) {
      query.set('customer-data:full-name', params.customerName);
    }

    return `${WompiService.CHECKOUT_URL}?${query.toString()}`;
  }

  // ─── Consultas a la API ────────────────────────────────────────────────────

  async getTransaction(transactionId: string): Promise<WompiTransaction> {
    const body = await this.request<{ data: WompiTransaction }>(
      'GET',
      `/transactions/${encodeURIComponent(transactionId)}`,
    );
    return body.data;
  }

  async findTransactionsByReference(
    reference: string,
  ): Promise<WompiTransaction[]> {
    const body = await this.request<{ data: WompiTransaction[] }>(
      'GET',
      `/transactions?reference=${encodeURIComponent(reference)}`,
    );
    return body.data ?? [];
  }

  /** Anula una transacción. Wompi solo lo permite para pagos con tarjeta. */
  async voidTransaction(transactionId: string): Promise<void> {
    await this.request(
      'POST',
      `/transactions/${encodeURIComponent(transactionId)}/void`,
      {},
    );
  }

  // ─── Validación de eventos ─────────────────────────────────────────────────

  /**
   * checksum = SHA256(valores de `signature.properties` + timestamp + secreto).
   * Devuelve `null` si no hay secreto configurado (no se puede validar).
   */
  verifyEventSignature(event: WompiEvent): boolean | null {
    if (!this.eventsSecret) return null;

    const properties = event.signature?.properties ?? [];
    const checksum = event.signature?.checksum ?? '';
    if (!properties.length || !checksum || event.timestamp == null) {
      return false;
    }

    const values = properties
      .map((path) =>
        path
          .split('.')
          .reduce<any>((obj, key) => (obj == null ? obj : obj[key]), event.data),
      )
      .map((v) => (v == null ? '' : String(v)))
      .join('');

    const expected = createHash('sha256')
      .update(`${values}${event.timestamp}${this.eventsSecret}`)
      .digest('hex');

    const a = Buffer.from(expected.toLowerCase());
    const b = Buffer.from(checksum.toLowerCase());
    return a.length === b.length && timingSafeEqual(a, b);
  }

  // ─── HTTP ──────────────────────────────────────────────────────────────────

  private async request<T>(
    method: 'GET' | 'POST',
    path: string,
    body?: unknown,
  ): Promise<T> {
    const response = await fetch(`${this.apiUrl}${path}`, {
      method,
      headers: {
        Authorization: `Bearer ${this.privateKey}`,
        'Content-Type': 'application/json',
      },
      body: body === undefined ? undefined : JSON.stringify(body),
    });

    const text = await response.text();
    let json: any = null;
    try {
      json = text ? JSON.parse(text) : null;
    } catch {
      // respuesta no JSON
    }

    if (!response.ok) {
      const reason =
        json?.error?.reason ??
        json?.error?.messages ??
        json?.error?.type ??
        text ??
        `HTTP ${response.status}`;
      throw new Error(
        `Wompi ${method} ${path} → ${response.status}: ${typeof reason === 'string' ? reason : JSON.stringify(reason)}`,
      );
    }

    return json as T;
  }
}
