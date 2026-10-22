import { createHash } from 'crypto';
import { ConfigService } from '@nestjs/config';
import { WompiService } from './wompi.service';

const env: Record<string, string> = {
  WOMPI_PUBLIC_KEY: 'pub_test_abc',
  WOMPI_PRIVATE_KEY: 'prv_test_abc',
  WOMPI_INTEGRITY_SECRET: 'test_integrity_secret',
  WOMPI_EVENTS_SECRET: 'test_events_secret',
};

const makeService = (overrides: Record<string, string> = {}) =>
  new WompiService({
    get: (k: string) => ({ ...env, ...overrides })[k],
  } as unknown as ConfigService);

const sha256 = (s: string) => createHash('sha256').update(s).digest('hex');

describe('WompiService', () => {
  it('usa sandbox con llaves de prueba y producción con pub_prod_', () => {
    expect(makeService().apiUrl).toBe('https://sandbox.wompi.co/v1');
    expect(
      makeService({ WOMPI_PUBLIC_KEY: 'pub_prod_x' }).apiUrl,
    ).toBe('https://production.wompi.co/v1');
  });

  it('firma el checkout con referencia + centavos + moneda + secreto', () => {
    const url = new URL(
      makeService().buildCheckoutUrl({
        reference: 'ref_1',
        amountInCents: 5000000,
        currency: 'COP',
        redirectUrl: 'https://app.test',
        customerEmail: 'a@b.co',
      }),
    );

    expect(url.origin + url.pathname).toBe('https://checkout.wompi.co/p/');
    expect(url.searchParams.get('public-key')).toBe('pub_test_abc');
    expect(url.searchParams.get('amount-in-cents')).toBe('5000000');
    expect(url.searchParams.get('signature:integrity')).toBe(
      sha256('ref_15000000COPtest_integrity_secret'),
    );
    expect(url.searchParams.get('customer-data:email')).toBe('a@b.co');
  });

  describe('verifyEventSignature', () => {
    const event = () => {
      const data = {
        transaction: { id: 'tx_1', status: 'APPROVED', amount_in_cents: 100 },
      };
      const timestamp = 1700000000;
      return {
        event: 'transaction.updated',
        data,
        timestamp,
        signature: {
          properties: [
            'transaction.id',
            'transaction.status',
            'transaction.amount_in_cents',
          ],
          checksum: sha256(`tx_1APPROVED100${timestamp}test_events_secret`),
        },
      } as any;
    };

    it('acepta un checksum válido (sin importar mayúsculas)', () => {
      const e = event();
      e.signature.checksum = e.signature.checksum.toUpperCase();
      expect(makeService().verifyEventSignature(e)).toBe(true);
    });

    it('rechaza un evento alterado', () => {
      const e = event();
      e.data.transaction.status = 'DECLINED';
      expect(makeService().verifyEventSignature(e)).toBe(false);
    });

    it('devuelve null si no hay secreto de eventos', () => {
      expect(
        makeService({ WOMPI_EVENTS_SECRET: '' }).verifyEventSignature(event()),
      ).toBeNull();
    });
  });
});
