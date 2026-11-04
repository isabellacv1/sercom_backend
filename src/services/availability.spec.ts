import { normalizeAvailability } from './availability';

describe('normalizeAvailability', () => {
  // 4 nov 2026, 10:00 en Colombia.
  const now = new Date('2026-11-04T15:00:00Z');

  it('ordena, quita repetidos, pasados y franjas inválidas', () => {
    expect(
      normalizeAvailability(
        [
          { date: '2026-11-06', from: '12:00', to: '17:00' },
          { date: '2026-11-05', from: '07:00', to: '12:00' },
          { date: '2026-11-05', from: '07:00', to: '12:00' },
          { date: '2026-11-03', from: '07:00', to: '12:00' },
          { date: '2026-11-07', from: '17:00', to: '12:00' },
        ],
        now,
      ),
    ).toEqual([
      { date: '2026-11-05', from: '07:00', to: '12:00' },
      { date: '2026-11-06', from: '12:00', to: '17:00' },
    ]);
  });

  it('acepta el día de hoy y una lista vacía', () => {
    expect(normalizeAvailability([{ date: '2026-11-04', from: '17:00', to: '20:00' }], now)).toHaveLength(1);
    expect(normalizeAvailability(undefined, now)).toEqual([]);
  });
});
