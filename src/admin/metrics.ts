/** Cálculos puros del panel de métricas (testeables sin base de datos). */

export interface PaidPaymentRow {
  client_id: string;
  worker_id: string;
  amount_total: number | string | null;
  amount_before_discount?: number | string | null;
  commission_amount: number | string | null;
  commission_before_discount?: number | string | null;
  worker_amount: number | string | null;
  service_price?: number | string | null;
  client_fee_amount?: number | string | null;
  worker_commission_amount?: number | string | null;
  surcharge_amount?: number | string | null;
  warranty_amount?: number | string | null;
  coupon_discount?: number | string | null;
  credit_applied?: number | string | null;
  payout_fee?: number | string | null;
  created_at: string;
}

const n = (v: unknown) => Number(v ?? 0) || 0;

/** Desglose de lo que gana SerCom en los pagos de servicios. */
export function paymentRevenue(rows: PaidPaymentRow[]) {
  let clientFees = 0;
  let workerCommissions = 0;
  let surcharge = 0;
  let warranty = 0;
  let discounts = 0;
  let instantFees = 0;
  let gmv = 0;
  let clientPaid = 0;
  let workerReceived = 0;
  let sercomNet = 0;

  for (const r of rows) {
    const baseCommission = n(r.commission_before_discount ?? r.commission_amount);
    const cf = n(r.client_fee_amount);
    const wc = n(r.worker_commission_amount);
    const w = n(r.warranty_amount);
    // Pagos antiguos sin desglose: toda la comisión cuenta como del técnico.
    const legacy = r.client_fee_amount == null && r.worker_commission_amount == null;
    clientFees += cf;
    workerCommissions += legacy ? baseCommission : wc;
    warranty += w;
    surcharge += legacy ? 0 : Math.max(0, baseCommission - cf - wc - w);
    discounts += n(r.coupon_discount) + n(r.credit_applied);
    instantFees += n(r.payout_fee);
    gmv += n(r.amount_before_discount ?? r.amount_total);
    clientPaid += n(r.amount_total);
    workerReceived += n(r.worker_amount) - n(r.payout_fee);
    sercomNet += n(r.commission_amount) + n(r.payout_fee);
  }

  const count = rows.length;
  const avg = (v: number) => (count ? Math.round(v / count) : 0);
  return {
    count,
    gmv,
    client_fees: clientFees,
    worker_commissions: workerCommissions,
    surcharge_share: surcharge,
    warranty,
    discounts,
    instant_fees: instantFees,
    net_revenue: sercomNet,
    per_service: {
      client_pays: avg(clientPaid),
      worker_receives: avg(workerReceived),
      sercom_keeps: avg(sercomNet),
      take_rate: clientPaid ? Math.round((sercomNet / clientPaid) * 1000) / 10 : 0,
    },
  };
}

/** % de clientes con 2 o más servicios pagados. */
export function repeatRate(rows: { client_id: string }[]) {
  const byClient = new Map<string, number>();
  for (const r of rows) byClient.set(r.client_id, (byClient.get(r.client_id) ?? 0) + 1);
  const clients = byClient.size;
  const repeat = [...byClient.values()].filter((c) => c >= 2).length;
  return { clients, repeat_clients: repeat, repeat_rate: clients ? Math.round((repeat / clients) * 1000) / 10 : 0 };
}

/** Conteo por semana (lunes) de las últimas [weeks] semanas, hora de Colombia. */
export function weekly(dates: string[], weeks = 8, now = new Date()) {
  const co = (d: Date) => new Date(d.getTime() - 5 * 3600 * 1000);
  const monday = (d: Date) => {
    const x = co(d);
    const day = (x.getUTCDay() + 6) % 7;
    return new Date(Date.UTC(x.getUTCFullYear(), x.getUTCMonth(), x.getUTCDate() - day));
  };
  const start = monday(now);
  const buckets = Array.from({ length: weeks }, (_, i) => {
    const d = new Date(start.getTime() - (weeks - 1 - i) * 7 * 86400000);
    return { week: d.toISOString().slice(0, 10), count: 0 };
  });
  for (const iso of dates) {
    const key = monday(new Date(iso)).toISOString().slice(0, 10);
    const b = buckets.find((x) => x.week === key);
    if (b) b.count++;
  }
  return buckets;
}
