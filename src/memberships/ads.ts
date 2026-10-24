import type { SupabaseClient } from '@supabase/supabase-js';

/** Precios de SERCOM Ads (anuncio destacado) por días. */
export function getBoostPrices(): Record<7 | 30, number> {
  const read = (name: string, fallback: number) => {
    const v = Number(process.env[name]);
    return Number.isFinite(v) && v >= 1000 ? Math.round(v) : fallback;
  };
  return { 7: read('BOOST_7_DAYS_PRICE', 9900), 30: read('BOOST_30_DAYS_PRICE', 29900) };
}

/** Ids (de [workerIds]) con anuncio destacado vigente. */
export async function getFeaturedWorkerIds(db: SupabaseClient<any>, workerIds: string[]) {
  const ids = [...new Set(workerIds.filter(Boolean))];
  if (!ids.length) return new Set<string>();
  const { data } = await db
    .from('worker_boosts')
    .select('worker_id')
    .in('worker_id', ids)
    .eq('status', 'active')
    .gt('period_end', new Date().toISOString());
  return new Set<string>((data ?? []).map((r: { worker_id: string }) => r.worker_id));
}

/** Orden: destacados (pagan anuncio), luego Pro, luego el resto. */
export function rankWorkers<T>(items: T[], score: (item: T) => number): T[] {
  return items
    .map((item, index) => ({ item, index, s: score(item) }))
    .sort((a, b) => (a.s === b.s ? a.index - b.index : b.s - a.s))
    .map((x) => x.item);
}
