import { ConfigService } from '@nestjs/config';
import { PaymentsService } from './payments.service';
import { WompiService, WompiTransaction } from './wompi.service';

/** Supabase en memoria: soporta los filtros que usa PaymentsService. */
function fakeDb(tables: Record<string, any[]>) {
  const from = (table: string) => {
    const rows = (tables[table] ??= []);
    const filters: ((r: any) => boolean)[] = [];
    let patch: Record<string, any> | null = null;

    const matching = () => rows.filter((r) => filters.every((f) => f(r)));
    const run = () => {
      const found = matching();
      if (patch) found.forEach((r) => Object.assign(r, patch));
      return found;
    };

    const q: any = {
      select: () => q,
      eq: (col: string, val: any) => (filters.push((r) => r[col] === val), q),
      in: (col: string, vals: any[]) =>
        (filters.push((r) => vals.includes(r[col])), q),
      order: () => q,
      update: (p: Record<string, any>) => ((patch = p), q),
      insert: (row: any) => {
        rows.push(row);
        return Promise.resolve({ error: null });
      },
      maybeSingle: () => Promise.resolve({ data: run()[0] ?? null, error: null }),
      single: () => Promise.resolve({ data: run()[0] ?? null, error: null }),
      then: (res: any) => res({ data: run(), error: null }),
    };
    return q;
  };
  return { from };
}

const PAYMENT_ID = '11111111-2222-3333-4444-555555555555';

function setup(transactions: WompiTransaction[]) {
  const tables: Record<string, any[]> = {
    payments: [
      {
        id: PAYMENT_ID,
        service_id: 'svc-1',
        client_id: 'client-1',
        worker_id: 'worker-1',
        status: 'pending',
        amount_total: 50000,
        currency: 'COP',
        checkout_reference: `${PAYMENT_ID}_abc`,
        provider_transaction_id: null,
        provider_status: null,
      },
    ],
    payment_audit_logs: [],
    services: [{ id: 'svc-1', title: 'Arreglo eléctrico' }],
  };

  const byId = new Map(transactions.map((t) => [t.id, t]));
  const wompi = {
    isConfigured: true,
    isSandbox: true,
    verifyEventSignature: jest.fn().mockReturnValue(true),
    getTransaction: jest.fn(async (id: string) => byId.get(id)!),
    findTransactionsByReference: jest.fn(async () => transactions),
  } as unknown as WompiService;

  const push = { sendToUser: jest.fn().mockResolvedValue(undefined) };
  const service = new PaymentsService(
    { sbRaw: fakeDb(tables) } as any,
    { get: () => undefined } as unknown as ConfigService,
    push as any,
    wompi,
    { findByWorkers: async () => new Map() } as any,
  );

  return { service, tables, push };
}

const tx = (over: Partial<WompiTransaction>): WompiTransaction => ({
  id: 'tx-1',
  reference: `${PAYMENT_ID}_abc`,
  status: 'APPROVED',
  amount_in_cents: 5_000_000,
  currency: 'COP',
  payment_method_type: 'NEQUI',
  ...over,
});

const event = (id: string) =>
  ({ event: 'transaction.updated', data: { transaction: { id } } }) as any;

describe('PaymentsService + Wompi', () => {
  it('un pago que llega PENDING y luego APPROVED queda en custodia', async () => {
    const pending = tx({ status: 'PENDING' });
    const { service, tables, push } = setup([pending]);

    await service.handleWompiEvent(event('tx-1'));
    expect(tables.payments[0].status).toBe('pending');
    expect(tables.payments[0].provider_status).toBe('PENDING');

    pending.status = 'APPROVED';
    await service.handleWompiEvent(event('tx-1'));

    expect(tables.payments[0].status).toBe('held');
    expect(tables.payments[0].provider_payment_method).toBe('NEQUI');
    expect(push.sendToUser).toHaveBeenCalledWith(
      'worker-1',
      expect.objectContaining({ title: 'Pago garantizado' }),
    );
  });

  it('es idempotente: el mismo evento dos veces notifica una sola vez', async () => {
    const { service, push } = setup([tx({})]);
    await service.handleWompiEvent(event('tx-1'));
    await service.handleWompiEvent(event('tx-1'));
    expect(push.sendToUser).toHaveBeenCalledTimes(2); // técnico + cliente
  });

  it('no aprueba si el monto no coincide', async () => {
    const { service, tables } = setup([tx({ amount_in_cents: 100 })]);
    await service.handleWompiEvent(event('tx-1'));
    expect(tables.payments[0].status).toBe('pending');
    expect(tables.payment_audit_logs[0].note).toContain('ALERTA');
  });

  it('un rechazo marca failed y un reintento aprobado lo recupera', async () => {
    const { service, tables } = setup([
      tx({ id: 'tx-1', status: 'DECLINED' }),
      tx({ id: 'tx-2', status: 'APPROVED' }),
    ]);
    await service.handleWompiEvent(event('tx-1'));
    expect(tables.payments[0].status).toBe('failed');

    await service.handleWompiEvent(event('tx-2'));
    expect(tables.payments[0].status).toBe('held');
  });

  it('un rechazo tardío no saca el pago de custodia', async () => {
    const { service, tables } = setup([
      tx({ id: 'tx-1', status: 'APPROVED' }),
      tx({ id: 'tx-2', status: 'DECLINED' }),
    ]);
    await service.handleWompiEvent(event('tx-1'));
    await service.handleWompiEvent(event('tx-2'));
    expect(tables.payments[0].status).toBe('held');
  });

  it('el polling (findByService) sincroniza sin depender del webhook', async () => {
    const { service, tables } = setup([tx({})]);
    const res = await service.findByService('client-1', 'svc-1');
    expect(res.payment.status).toBe('held');
    expect(tables.payments[0].status).toBe('held');
  });

  it('al confirmar el servicio libera la custodia para transferencia manual', async () => {
    const { service, tables } = setup([tx({})]);
    await service.handleWompiEvent(event('tx-1'));
    await service.disburseWorkerPayment('svc-1');
    expect(tables.payments[0].status).toBe('released');
    expect(tables.payments[0].payout_status).toBe('pending_manual');
  });
});
