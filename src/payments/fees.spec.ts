import { computePaymentAmounts, getFeeRates } from './fees';

describe('comisiones a ambos lados', () => {
  const original = { ...process.env };
  afterEach(() => {
    process.env = { ...original };
  });

  it('por defecto: 5% al cliente y 10% al técnico', () => {
    delete process.env.CLIENT_SERVICE_FEE_RATE;
    delete process.env.WORKER_COMMISSION_RATE;

    expect(computePaymentAmounts(100000)).toEqual({
      service_price: 100000,
      surcharge_amount: 0,
      surcharge_reasons: null,
      client_fee_amount: 5000,
      worker_commission_amount: 10000,
      amount_total: 105000,
      commission_amount: 15000,
      worker_amount: 90000,
    });
  });

  it('lo que paga el cliente = lo que recibe el técnico + ingreso de SerCom', () => {
    for (const price of [1800, 33333, 99999, 250000]) {
      const a = computePaymentAmounts(price);
      expect(a.amount_total).toBe(a.worker_amount + a.commission_amount);
    }
  });

  it('las tasas se configuran por entorno', () => {
    process.env.CLIENT_SERVICE_FEE_RATE = '0.08';
    process.env.WORKER_COMMISSION_RATE = '0.12';
    expect(getFeeRates()).toEqual({ clientFeeRate: 0.08, workerCommissionRate: 0.12 });
  });

  it('ignora valores inválidos o exagerados', () => {
    process.env.CLIENT_SERVICE_FEE_RATE = 'abc';
    process.env.WORKER_COMMISSION_RATE = '0.9';
    expect(getFeeRates()).toEqual({ clientFeeRate: 0.05, workerCommissionRate: 0.1 });
  });
});
