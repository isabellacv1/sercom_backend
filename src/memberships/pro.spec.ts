import { getProConfig, proFirst, startOfMonthCO } from './pro';

describe('SERCOM Pro', () => {
  const original = { ...process.env };
  afterEach(() => {
    process.env = { ...original };
  });

  it('valores por defecto: $39.900/mes, 30 días, 7% de comisión, 10 propuestas gratis', () => {
    for (const k of ['PRO_MONTHLY_PRICE', 'PRO_PERIOD_DAYS', 'PRO_WORKER_COMMISSION_RATE', 'FREE_MONTHLY_PROPOSALS']) {
      delete process.env[k];
    }
    expect(getProConfig()).toEqual({
      monthlyPrice: 39900,
      periodDays: 30,
      workerCommissionRate: 0.07,
      freeMonthlyProposals: 10,
    });
  });

  it('se configura por entorno e ignora valores absurdos', () => {
    process.env.PRO_MONTHLY_PRICE = '49900';
    process.env.PRO_WORKER_COMMISSION_RATE = '2';
    expect(getProConfig().monthlyPrice).toBe(49900);
    expect(getProConfig().workerCommissionRate).toBe(0.07);
  });

  it('los Pro van primero sin cambiar el orden entre iguales', () => {
    const items = [
      { id: 'a', pro: false },
      { id: 'b', pro: true },
      { id: 'c', pro: false },
      { id: 'd', pro: true },
    ];
    expect(proFirst(items, (i) => i.pro).map((i) => i.id)).toEqual(['b', 'd', 'a', 'c']);
  });

  it('el mes se cuenta en hora de Colombia', () => {
    // 1 de noviembre 02:00 UTC = 31 de octubre 21:00 en Colombia.
    expect(startOfMonthCO(new Date('2026-11-01T02:00:00Z')).toISOString()).toBe(
      '2026-10-01T05:00:00.000Z',
    );
  });
});
