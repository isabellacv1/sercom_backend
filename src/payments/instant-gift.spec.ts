import { instantFee } from './instant-payout';
import { newGiftCode } from './gift-cards.service';
import { rankWorkers } from '../memberships/ads';

describe('cobro inmediato', () => {
  it('2% con mínimo de $1.000', () => {
    expect(instantFee(90000)).toBe(1800);
    expect(instantFee(20000)).toBe(1000);
  });

  it('la comisión nunca supera lo que se cobra', () => {
    expect(instantFee(500)).toBe(500);
  });
});

describe('tarjetas de regalo', () => {
  it('códigos legibles y sin caracteres confusos (0/O/1/I)', () => {
    for (let i = 0; i < 50; i++) {
      expect(newGiftCode()).toMatch(/^SC-[A-HJ-NP-Z2-9]{4}-[A-HJ-NP-Z2-9]{4}$/);
    }
  });
});

describe('orden de profesionales', () => {
  it('destacados primero, luego Pro, luego el resto', () => {
    const items = [
      { id: 'normal', featured: false, pro: false },
      { id: 'pro', featured: false, pro: true },
      { id: 'destacado', featured: true, pro: false },
      { id: 'destacado-pro', featured: true, pro: true },
    ];
    expect(
      rankWorkers(items, (i) => (i.featured ? 2 : 0) + (i.pro ? 1 : 0)).map((i) => i.id),
    ).toEqual(['destacado-pro', 'destacado', 'pro', 'normal']);
  });
});
