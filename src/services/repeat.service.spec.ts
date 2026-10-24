import { nextRunAfter } from './repeat.service';

describe('servicios recurrentes', () => {
  const now = new Date('2026-10-23T12:00:00Z');

  it('la siguiente fecha avanza por el intervalo hasta quedar en el futuro', () => {
    const due = new Date('2026-10-20T12:00:00Z');
    expect(nextRunAfter(due, 15, now).toISOString()).toBe('2026-11-04T12:00:00.000Z');
  });

  it('si estuvo apagado varios ciclos, no crea fechas en el pasado', () => {
    const longAgo = new Date('2026-08-01T12:00:00Z');
    const next = nextRunAfter(longAgo, 7, now);
    expect(next.getTime()).toBeGreaterThan(now.getTime());
    expect(next.getTime() - now.getTime()).toBeLessThanOrEqual(7 * 86400000);
  });
});
