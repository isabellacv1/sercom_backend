import { computePaymentAmounts } from './fees';
import { dynamicSurcharge, proposalDateTime } from './dynamic-pricing';

describe('tarifa dinámica', () => {
  it('martes 10 a. m. sin urgencia: sin recargo', () => {
    const s = dynamicSurcharge({ isUrgent: false, when: proposalDateTime('2026-10-27', '10:00') });
    expect(s.rate).toBe(0);
    expect(s.reasons).toEqual([]);
  });

  it('de noche (8 p. m.): +10%', () => {
    const s = dynamicSurcharge({ isUrgent: false, when: proposalDateTime('2026-10-27', '20:00') });
    expect(s.reasons).toEqual(['night']);
    expect(s.rate).toBeCloseTo(0.1);
  });

  it('domingo y festivo de Colombia: +10%', () => {
    expect(dynamicSurcharge({ isUrgent: false, when: proposalDateTime('2026-10-25', '10:00') }).reasons)
      .toEqual(['sunday_holiday']);
    // 2 de noviembre de 2026 (lunes festivo, Todos los Santos).
    expect(dynamicSurcharge({ isUrgent: false, when: proposalDateTime('2026-11-02', '10:00') }).reasons)
      .toEqual(['sunday_holiday']);
  });

  it('urgente + noche + domingo se topa en 25%', () => {
    const s = dynamicSurcharge({ isUrgent: true, when: proposalDateTime('2026-10-25', '22:00') });
    expect(s.reasons).toEqual(['urgent', 'night', 'sunday_holiday']);
    expect(s.rate).toBe(0.25);
  });

  it('el recargo se reparte mitad técnico y mitad SerCom', () => {
    const a = computePaymentAmounts(
      100000,
      { clientFeeRate: 0.05, workerCommissionRate: 0.1 },
      { rate: 0.15, reasons: ['urgent'], workerShare: 0.5 },
    );
    expect(a.surcharge_amount).toBe(15000);
    expect(a.amount_total).toBe(120000); // 100.000 + 5.000 + 15.000
    expect(a.worker_amount).toBe(97500); // 90.000 + 7.500
    expect(a.commission_amount).toBe(22500); // 15.000 + 7.500
    expect(a.amount_total).toBe(a.worker_amount + a.commission_amount);
  });
});
