import { paymentRevenue, repeatRate, weekly } from './metrics';
import { computePaymentAmounts } from '../payments/fees';
import { warrantyPrice } from '../payments/warranty';
import { sanitizePhotoQuote } from '../chatbot/chatbot.service';

const row = (extra: Record<string, unknown> = {}) => {
  const a = computePaymentAmounts(
    100000,
    { clientFeeRate: 0.05, workerCommissionRate: 0.1 },
    { rate: 0.1, reasons: ['night'], workerShare: 0.5 },
  );
  return { client_id: 'c1', worker_id: 'w1', created_at: '2026-10-20T15:00:00Z', ...a, ...extra } as any;
};

describe('métricas del MVP', () => {
  it('separa la ganancia de SerCom por canal', () => {
    const r = paymentRevenue([row()]);
    expect(r.client_fees).toBe(5000);
    expect(r.worker_commissions).toBe(10000);
    expect(r.surcharge_share).toBe(5000); // mitad del 10% de recargo
    expect(r.per_service).toEqual({ client_pays: 115000, worker_receives: 95000, sercom_keeps: 20000, take_rate: 17.4 });
  });

  it('la garantía extendida y el cobro inmediato suman a SerCom', () => {
    const base = row();
    const r = paymentRevenue([
      row({
        warranty_amount: 6000,
        amount_total: base.amount_total + 6000,
        commission_amount: base.commission_amount + 6000,
        payout_fee: 1900,
      }),
    ]);
    expect(r.warranty).toBe(6000);
    expect(r.surcharge_share).toBe(5000);
    expect(r.instant_fees).toBe(1900);
    expect(r.per_service.sercom_keeps).toBe(27900);
    expect(r.per_service.worker_receives).toBe(93100);
  });

  it('clientes que repiten', () => {
    expect(repeatRate([{ client_id: 'a' }, { client_id: 'a' }, { client_id: 'b' }])).toEqual({
      clients: 2,
      repeat_clients: 1,
      repeat_rate: 50,
    });
  });

  it('agrupa por semana (lunes, hora de Colombia)', () => {
    const w = weekly(['2026-10-26T15:00:00Z', '2026-10-27T15:00:00Z', '2026-10-20T15:00:00Z'], 2, new Date('2026-10-27T20:00:00Z'));
    expect(w).toEqual([
      { week: '2026-10-19', count: 1 },
      { week: '2026-10-26', count: 2 },
    ]);
  });
});

describe('garantía extendida', () => {
  it('6% del servicio con mínimo de $3.000', () => {
    expect(warrantyPrice(100000)).toBe(6000);
    expect(warrantyPrice(30000)).toBe(3000);
  });
});

describe('cotización con foto', () => {
  it('ordena el rango, redondea y pone límites', () => {
    const q = sanitizePhotoQuote({ price_min: 180400, price_max: 90000, category: 'Plomería', tips: ['a', 2] });
    expect([q.price_min, q.price_max]).toEqual([90000, 180000]);
    expect(q.tips).toEqual(['a']);
  });

  it('si la foto no es del hogar no da precio ni categoría', () => {
    const q = sanitizePhotoQuote({ is_home_issue: false, category: 'Plomería', price_min: 50000 });
    expect(q.category).toBeNull();
    expect(q.price_min).toBeNull();
  });
});
