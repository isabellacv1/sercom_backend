/**
 * Tarifa dinámica (como Rappi en lluvia o alta demanda): recargo sobre el
 * precio del servicio según cuándo se hace. Se reparte entre el profesional
 * (SURCHARGE_WORKER_SHARE) y SerCom. Tasas configurables por entorno.
 */

/** Festivos de Colombia (Ley Emiliani y Semana Santa), YYYY-MM-DD. */
export const CO_HOLIDAYS = new Set([
  // 2026
  '2026-01-01', '2026-01-12', '2026-03-23', '2026-04-02', '2026-04-03', '2026-05-01',
  '2026-05-18', '2026-06-08', '2026-06-15', '2026-06-29', '2026-07-20', '2026-08-07',
  '2026-08-17', '2026-10-12', '2026-11-02', '2026-11-16', '2026-12-08', '2026-12-25',
  // 2027
  '2027-01-01', '2027-01-11', '2027-03-22', '2027-03-25', '2027-03-26', '2027-05-01',
  '2027-05-10', '2027-05-31', '2027-06-07', '2027-07-05', '2027-07-20', '2027-08-07',
  '2027-08-16', '2027-10-18', '2027-11-01', '2027-11-15', '2027-12-08', '2027-12-25',
]);

export type SurchargeReason = 'urgent' | 'night' | 'sunday_holiday';

export interface Surcharge {
  rate: number;
  reasons: SurchargeReason[];
  workerShare: number;
}

function rate(name: string, fallback: number) {
  const v = Number(process.env[name]);
  return Number.isFinite(v) && v >= 0 && v <= 1 ? v : fallback;
}

export function getSurchargeRates() {
  return {
    urgent: rate('SURCHARGE_URGENT_RATE', 0.15),
    night: rate('SURCHARGE_NIGHT_RATE', 0.1),
    sundayHoliday: rate('SURCHARGE_SUNDAY_HOLIDAY_RATE', 0.1),
    max: rate('SURCHARGE_MAX_RATE', 0.25),
    workerShare: rate('SURCHARGE_WORKER_SHARE', 0.5),
  };
}

/** Hora local de Colombia (UTC−5, sin horario de verano). */
function colombia(date: Date) {
  const co = new Date(date.getTime() - 5 * 3600 * 1000);
  return {
    hour: co.getUTCHours(),
    weekday: co.getUTCDay(), // 0 = domingo
    day: co.toISOString().slice(0, 10),
  };
}

/**
 * Recargo para un servicio urgente y/o en [when] (fecha y hora del trabajo).
 * Noche: de 7 p. m. a 7 a. m.
 */
export function dynamicSurcharge(params: { isUrgent: boolean; when: Date | null }): Surcharge {
  const r = getSurchargeRates();
  const reasons: SurchargeReason[] = [];
  let total = 0;

  if (params.isUrgent) {
    reasons.push('urgent');
    total += r.urgent;
  }
  if (params.when) {
    const { hour, weekday, day } = colombia(params.when);
    if (hour >= 19 || hour < 7) {
      reasons.push('night');
      total += r.night;
    }
    if (weekday === 0 || CO_HOLIDAYS.has(day)) {
      reasons.push('sunday_holiday');
      total += r.sundayHoliday;
    }
  }
  return { rate: Math.min(total, r.max), reasons, workerShare: r.workerShare };
}

/**
 * Fecha y hora del trabajo a partir de la propuesta (available_date
 * "YYYY-MM-DD" + available_from "HH:mm", hora de Colombia).
 */
export function proposalDateTime(date?: string | null, from?: string | null): Date | null {
  if (!date) return null;
  const time = /^\d{1,2}:\d{2}/.test(from ?? '') ? from!.slice(0, 5).padStart(5, '0') : '09:00';
  const d = new Date(`${date.slice(0, 10)}T${time}:00-05:00`);
  return Number.isNaN(d.getTime()) ? null : d;
}
