import { ConfigService } from '@nestjs/config';
import { TipsService } from './tips.service';
import { WompiService, WompiTransaction } from './wompi.service';

/** Supabase en memoria con los filtros que usa TipsService. */
function fakeDb(tables: Record<string, any[]>) {
  const from = (table: string) => {
    const rows = (tables[table] ??= []);
    const filters: ((r: any) => boolean)[] = [];
    let patch: Record<string, any> | null = null;
    const run = () => {
      const found = rows.filter((r) => filters.every((f) => f(r)));
      if (patch) found.forEach((r) => Object.assign(r, patch));
      return found;
    };
    const q: any = {
      select: () => q,
      eq: (c: string, v: any) => (filters.push((r) => r[c] === v), q),
      update: (p: Record<string, any>) => ((patch = p), q),
      maybeSingle: () => Promise.resolve({ data: run()[0] ?? null, error: null }),
      // Supabase ejecuta el query al hacer await (update sin select).
      then: (resolve: any) => resolve({ data: run(), error: null }),
    };
    return q;
  };
  return { from };
}

const tipRow = () => ({
  id: '11111111-1111-1111-1111-111111111111',
  service_id: 'svc-1',
  worker_id: 'worker-1',
  amount: 5000,
  status: 'pending',
});

const tx = (over: Partial<WompiTransaction> = {}): WompiTransaction => ({
  id: 'tx-1',
  reference: 'tip_11111111-1111-1111-1111-111111111111_abc',
  status: 'APPROVED',
  amount_in_cents: 500000,
  currency: 'COP',
  ...over,
});

function setup() {
  const tables: Record<string, any[]> = { service_tips: [tipRow()] };
  const push = { sendToUser: jest.fn().mockResolvedValue(undefined) };
  const service = new TipsService(
    { sbRaw: fakeDb(tables) } as any,
    { isConfigured: true } as unknown as WompiService,
    push as any,
    { get: () => undefined } as unknown as ConfigService,
  );
  return { service, tables, push };
}

describe('TipsService', () => {
  it('una propina aprobada queda pagada y avisa al profesional una sola vez', async () => {
    const { service, tables, push } = setup();
    await service.applyWompiTransaction(tx());
    await service.applyWompiTransaction(tx());

    expect(tables.service_tips[0].status).toBe('paid');
    expect(tables.service_tips[0].payout_status).toBe('pending_manual');
    expect(push.sendToUser).toHaveBeenCalledTimes(1);
    expect(push.sendToUser).toHaveBeenCalledWith(
      'worker-1',
      expect.objectContaining({ title: '¡Recibiste una propina!' }),
    );
  });

  it('no la marca pagada si el monto no coincide', async () => {
    const { service, tables } = setup();
    await service.applyWompiTransaction(tx({ amount_in_cents: 100 }));
    expect(tables.service_tips[0].status).toBe('pending');
  });

  it('un rechazo la marca como fallida', async () => {
    const { service, tables } = setup();
    await service.applyWompiTransaction(tx({ status: 'DECLINED' }));
    expect(tables.service_tips[0].status).toBe('failed');
  });
});
