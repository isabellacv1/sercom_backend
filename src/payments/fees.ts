/**
 * Modelo de ingresos de SerCom: comisión a ambos lados.
 *
 *   precio del servicio (lo que cobra el técnico en su propuesta)  P
 *   tarifa de servicio al cliente   = P × CLIENT_SERVICE_FEE_RATE  (se suma)
 *   comisión al técnico             = P × WORKER_COMMISSION_RATE   (se descuenta)
 *
 *   el cliente paga   P + tarifa
 *   el técnico recibe P − comisión
 *   SerCom se queda   tarifa + comisión
 *
 * Las tasas se configuran por entorno (Render) sin cambiar código.
 */
export interface FeeRates {
  clientFeeRate: number;
  workerCommissionRate: number;
}

export interface PaymentAmounts {
  service_price: number;
  /** Recargo de tarifa dinámica (urgente, noche, domingo/festivo). */
  surcharge_amount: number;
  surcharge_reasons: string[] | null;
  client_fee_amount: number;
  worker_commission_amount: number;
  /** Lo que paga el cliente en Wompi. */
  amount_total: number;
  /** Ingreso total de SerCom. */
  commission_amount: number;
  worker_amount: number;
}

const DEFAULT_CLIENT_FEE_RATE = 0.05;
const DEFAULT_WORKER_COMMISSION_RATE = 0.1;
const MAX_RATE = 0.5;

function readRate(name: string, fallback: number): number {
  const raw = process.env[name];
  if (raw == null || raw.trim() === '') return fallback;
  const value = Number(raw);
  return Number.isFinite(value) && value >= 0 && value <= MAX_RATE
    ? value
    : fallback;
}

export function getFeeRates(): FeeRates {
  return {
    clientFeeRate: readRate('CLIENT_SERVICE_FEE_RATE', DEFAULT_CLIENT_FEE_RATE),
    workerCommissionRate: readRate(
      'WORKER_COMMISSION_RATE',
      DEFAULT_WORKER_COMMISSION_RATE,
    ),
  };
}

export function computePaymentAmounts(
  servicePrice: number,
  rates: FeeRates = getFeeRates(),
  surcharge?: { rate: number; reasons: string[]; workerShare: number },
): PaymentAmounts {
  const price = Math.round(servicePrice);
  const clientFee = Math.round(price * rates.clientFeeRate);
  const workerCommission = Math.round(price * rates.workerCommissionRate);
  const extra = surcharge ? Math.round(price * surcharge.rate) : 0;
  const extraForWorker = surcharge ? Math.round(extra * surcharge.workerShare) : 0;

  return {
    service_price: price,
    surcharge_amount: extra,
    surcharge_reasons: extra > 0 ? surcharge!.reasons : null,
    client_fee_amount: clientFee,
    worker_commission_amount: workerCommission,
    amount_total: price + clientFee + extra,
    commission_amount: clientFee + workerCommission + (extra - extraForWorker),
    worker_amount: price - workerCommission + extraForWorker,
  };
}
