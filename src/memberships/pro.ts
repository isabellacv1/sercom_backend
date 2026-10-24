import type { SupabaseClient } from '@supabase/supabase-js';
import { FeeRates, getFeeRates } from '../payments/fees';

/**
 * SERCOM Pro: membresía mensual para profesionales.
 *  - comisión reducida (PRO_WORKER_COMMISSION_RATE, 7% por defecto)
 *  - aparecen primero en propuestas y búsquedas, con sello "PRO"
 *  - propuestas ilimitadas (los gratuitos tienen FREE_MONTHLY_PROPOSALS)
 * Todo configurable por entorno (Render).
 */
export interface ProConfig {
  monthlyPrice: number;
  periodDays: number;
  workerCommissionRate: number;
  freeMonthlyProposals: number;
}

function readNumber(name: string, fallback: number, min: number, max: number) {
  const raw = process.env[name];
  const value = raw == null || raw.trim() === '' ? NaN : Number(raw);
  return Number.isFinite(value) && value >= min && value <= max ? value : fallback;
}

export function getProConfig(): ProConfig {
  return {
    monthlyPrice: Math.round(readNumber('PRO_MONTHLY_PRICE', 39900, 1000, 1000000)),
    periodDays: Math.round(readNumber('PRO_PERIOD_DAYS', 30, 1, 366)),
    workerCommissionRate: readNumber('PRO_WORKER_COMMISSION_RATE', 0.07, 0, 0.5),
    freeMonthlyProposals: Math.round(readNumber('FREE_MONTHLY_PROPOSALS', 10, 1, 1000)),
  };
}

type Db = SupabaseClient<any>;

/** Ids (de [workerIds]) con membresía Pro vigente. */
export async function getProWorkerIds(db: Db, workerIds: string[]): Promise<Set<string>> {
  const ids = [...new Set(workerIds.filter(Boolean))];
  if (!ids.length) return new Set();
  const { data } = await db
    .from('worker_memberships')
    .select('worker_id')
    .in('worker_id', ids)
    .eq('plan', 'pro')
    .eq('status', 'active')
    .gt('period_end', new Date().toISOString());
  return new Set((data ?? []).map((r: { worker_id: string }) => r.worker_id));
}

export async function isProWorker(db: Db, workerId: string): Promise<boolean> {
  return (await getProWorkerIds(db, [workerId])).has(workerId);
}

/**
 * SERCOM Plus: membresía mensual para clientes (como Rappi Prime).
 *  - sin tarifa de servicio
 *  - atención prioritaria en soporte
 *  - garantía extendida (PLUS_WARRANTY_DAYS) para reportar problemas
 */
export interface PlusConfig {
  monthlyPrice: number;
  periodDays: number;
  warrantyDays: number;
  standardWarrantyDays: number;
}

export function getPlusConfig(): PlusConfig {
  return {
    monthlyPrice: Math.round(readNumber('PLUS_MONTHLY_PRICE', 14900, 1000, 1000000)),
    periodDays: Math.round(readNumber('PLUS_PERIOD_DAYS', 30, 1, 366)),
    warrantyDays: Math.round(readNumber('PLUS_WARRANTY_DAYS', 30, 1, 365)),
    standardWarrantyDays: Math.round(readNumber('STANDARD_WARRANTY_DAYS', 7, 1, 365)),
  };
}

/** Plan de mantenimiento "Hogar Tranquilo": Plus + saldo mensual + revisiones. */
export function getCareConfig() {
  return {
    monthlyPrice: Math.round(readNumber('CARE_MONTHLY_PRICE', 44900, 1000, 1000000)),
    monthlyCredit: Math.round(readNumber('CARE_MONTHLY_CREDIT', 35000, 0, 1000000)),
    periodDays: Math.round(readNumber('CARE_PERIOD_DAYS', 30, 1, 366)),
    checkupEveryDays: Math.round(readNumber('CARE_CHECKUP_DAYS', 90, 7, 366)),
  };
}

/** Plus o plan de mantenimiento (que incluye los beneficios de Plus). */
export async function isPlusClient(db: Db, userId: string): Promise<boolean> {
  const { data } = await db
    .from('worker_memberships')
    .select('id')
    .eq('worker_id', userId)
    .in('plan', ['plus', 'care'])
    .eq('status', 'active')
    .gt('period_end', new Date().toISOString())
    .limit(1)
    .maybeSingle();
  return !!data;
}

/**
 * Tasas de un servicio: el profesional Pro paga menos comisión y el cliente
 * Plus no paga tarifa de servicio.
 */
export async function feeRatesFor(
  db: Db,
  parties: { workerId: string; clientId: string },
): Promise<FeeRates> {
  const rates = getFeeRates();
  const [pro, plus] = await Promise.all([
    isProWorker(db, parties.workerId),
    isPlusClient(db, parties.clientId),
  ]);
  return {
    clientFeeRate: plus ? 0 : rates.clientFeeRate,
    workerCommissionRate: pro
      ? Math.min(rates.workerCommissionRate, getProConfig().workerCommissionRate)
      : rates.workerCommissionRate,
  };
}

/** Inicio del mes calendario actual (zona Colombia, UTC−5). */
export function startOfMonthCO(now = new Date()): Date {
  const co = new Date(now.getTime() - 5 * 60 * 60 * 1000);
  return new Date(Date.UTC(co.getUTCFullYear(), co.getUTCMonth(), 1, 5, 0, 0));
}

/** Propuestas enviadas este mes por un profesional. */
export async function proposalsThisMonth(db: Db, workerId: string): Promise<number> {
  const { count } = await db
    .from('proposals')
    .select('id', { count: 'exact', head: true })
    .eq('technician_id', workerId)
    .gte('created_at', startOfMonthCO().toISOString());
  return count ?? 0;
}

/** Ordena poniendo primero a los Pro, conservando el orden previo entre iguales. */
export function proFirst<T>(items: T[], isPro: (item: T) => boolean): T[] {
  return items
    .map((item, index) => ({ item, index, pro: isPro(item) }))
    .sort((a, b) => (a.pro === b.pro ? a.index - b.index : a.pro ? -1 : 1))
    .map((x) => x.item);
}
