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
    services: [{ id: 'svc-1', title: 'Arreglo eléctrico', category_id: null }],
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
  const memberships = { applyWompiTransaction: jest.fn().mockResolvedValue(undefined) };
  const tips = { applyWompiTransaction: jest.fn().mockResolvedValue(undefined) };
  const service = new PaymentsService(
    { sbRaw: fakeDb(tables) } as any,
    { get: () => undefined } as unknown as ConfigService,
    push as any,
    wompi,
    { findByWorkers: async () => new Map() } as any,
    memberships as any,
    tips as any,
    {
      evaluate: async ({ baseAmount }: { baseAmount: number }) => ({
        coupon: { code: 'BIENVENIDO' },
        discount: Math.round(baseAmount * 0.2),
      }),
    } as any,
    { balance: async () => 10000, consumeForPayment: jest.fn() } as any,
    { onClientPaymentHeld: jest.fn(), onWorkerJobCompleted: jest.fn().mockResolvedValue(undefined) } as any,
    { applyWompiTransaction: jest.fn() } as any,
    { applyWompiTransaction: jest.fn() } as any,
  );

  return { service, tables, push, memberships, tips };
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

  it('un pago de SERCOM Pro (referencia mem_) no toca los pagos de servicios', async () => {
    const membershipTx = tx({ id: 'tx-mem', reference: 'mem_abc_123' });
    const { service, tables, memberships } = setup([membershipTx]);
    await service.handleWompiEvent(event('tx-mem'));
    expect(memberships.applyWompiTransaction).toHaveBeenCalledWith(membershipTx);
    expect(tables.payments[0].status).toBe('pending');
  });

  it('una propina (referencia tip_) se procesa aparte del pago del servicio', async () => {
    const tipTx = tx({ id: 'tx-tip', reference: 'tip_abc_123' });
    const { service, tables, tips } = setup([tipTx]);
    await service.handleWompiEvent(event('tx-tip'));
    expect(tips.applyWompiTransaction).toHaveBeenCalledWith(tipTx);
    expect(tables.payments[0].status).toBe('pending');
  });

  it('cupón y saldo bajan el cobro; el técnico recibe lo mismo y SerCom asume el descuento', async () => {
    const { service, tables } = setup([]);
    Object.assign(tables.payments[0], {
      amount_total: 105000,
      commission_amount: 15000,
      worker_amount: 90000,
    });

    const res = await service.applyDiscounts('client-1', 'svc-1', {
      coupon_code: 'BIENVENIDO',
      use_credit: true,
    });

    expect(res.discount).toEqual({
      coupon_code: 'BIENVENIDO',
      coupon_discount: 21000,
      credit_applied: 10000,
      amount_before_discount: 105000,
      amount_total: 74000,
    });
    expect(tables.payments[0].worker_amount).toBe(90000);
    expect(tables.payments[0].commission_amount).toBe(15000 - 31000);
  });

  it('los descuentos nunca dejan el cobro por debajo de $2.000', async () => {
    const { service, tables } = setup([]);
    Object.assign(tables.payments[0], { amount_total: 5000, commission_amount: 700, worker_amount: 4300 });

    const res = await service.applyDiscounts('client-1', 'svc-1', { use_credit: true });

    expect(res.discount.amount_total).toBe(2000);
    expect(res.discount.credit_applied).toBe(3000);
  });
});
