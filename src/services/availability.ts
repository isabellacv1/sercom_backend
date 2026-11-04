/** Horario en que el cliente puede recibir al profesional (hora de Colombia). */
export interface AvailabilitySlot {
  date: string; // YYYY-MM-DD
  from: string; // HH:mm
  to: string; // HH:mm
}

const minutes = (hhmm: string) => {
  const [h, m] = hhmm.split(':').map(Number);
  return h * 60 + m;
};

/** Fecha de hoy en Colombia (UTC−5), YYYY-MM-DD. */
function todayInColombia(now: Date) {
  return new Date(now.getTime() - 5 * 3600 * 1000).toISOString().slice(0, 10);
}

/**
 * Limpia los horarios del cliente: quita los pasados, los inválidos
 * (fin antes del inicio) y los repetidos, y los ordena.
 */
export function normalizeAvailability(
  slots: AvailabilitySlot[] | null | undefined,
  now: Date = new Date(),
): AvailabilitySlot[] {
  if (!Array.isArray(slots)) return [];
  const today = todayInColombia(now);
  const seen = new Set<string>();
  return slots
    .map((s) => ({ date: String(s.date).slice(0, 10), from: s.from, to: s.to }))
    .filter((s) => s.date >= today && minutes(s.to) > minutes(s.from))
    .filter((s) => {
      const key = `${s.date} ${s.from} ${s.to}`;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    })
    .sort((a, b) => `${a.date} ${a.from}`.localeCompare(`${b.date} ${b.from}`));
}
