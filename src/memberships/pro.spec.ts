import { feeRatesFor, getProConfig, proFirst, startOfMonthCO } from './pro';

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

  describe('tarifas según membresías', () => {
    /** Membresías activas: [usuario, plan]. */
    const db = (active: [string, 'pro' | 'plus'][]) =>
      ({
        from: () => {
          const f: Record<string, any> = {};
          const q: any = {
            select: () => q,
            in: (_c: string, v: string[]) => ((f.ids = v), q),
            eq: (c: string, v: any) => ((f[c] = v), q),
            gt: () => q,
            limit: () => q,
            matches: () =>
              active.filter(
                ([u, plan]) =>
                  plan === f.plan && (f.ids ? f.ids.includes(u) : u === f.worker_id),
              ),
            maybeSingle: () => Promise.resolve({ data: q.matches()[0] ? { id: 'm' } : null }),
            then: (r: any) => r({ data: q.matches().map(([u]: [string]) => ({ worker_id: u })) }),
          };
          return q;
        },
      }) as any;

    it('sin membresías: 5% al cliente, 10% al técnico', async () => {
      expect(await feeRatesFor(db([]), { workerId: 'w', clientId: 'c' })).toEqual({
        clientFeeRate: 0.05,
        workerCommissionRate: 0.1,
      });
    });

    it('cliente Plus no paga tarifa; técnico Pro paga 7%', async () => {
      expect(
        await feeRatesFor(db([['c', 'plus'], ['w', 'pro']]), { workerId: 'w', clientId: 'c' }),
      ).toEqual({ clientFeeRate: 0, workerCommissionRate: 0.07 });
    });

    it('un Plus de cliente no convierte en Pro a esa persona como técnico', async () => {
      expect(
        await feeRatesFor(db([['w', 'plus']]), { workerId: 'w', clientId: 'c' }),
      ).toEqual({ clientFeeRate: 0.05, workerCommissionRate: 0.1 });
    });
  });
});
