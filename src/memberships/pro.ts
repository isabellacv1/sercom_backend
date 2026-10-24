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
    .eq('status', 'active')
    .gt('period_end', new Date().toISOString());
  return new Set((data ?? []).map((r: { worker_id: string }) => r.worker_id));
}

export async function isProWorker(db: Db, workerId: string): Promise<boolean> {
  return (await getProWorkerIds(db, [workerId])).has(workerId);
}

/** Tasas a cobrar en un servicio de este profesional (Pro paga menos). */
export async function feeRatesForWorker(db: Db, workerId: string): Promise<FeeRates> {
  const rates = getFeeRates();
  if (!(await isProWorker(db, workerId))) return rates;
  return {
    ...rates,
    workerCommissionRate: Math.min(rates.workerCommissionRate, getProConfig().workerCommissionRate),
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
