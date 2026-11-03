import { arrivalDeadline, distanceKm, etaMinutes, isLate } from './live-location.service';

describe('seguimiento en vivo', () => {
  it('distancia entre dos puntos de Cali (~3 km) y llegada estimada', () => {
    // Parque del Perro → Unicentro, aprox. 3 km en línea recta.
    const km = distanceKm({ lat: 3.4267, lng: -76.5462 }, { lat: 3.3994, lng: -76.5395 });
    expect(km).toBeGreaterThan(2.8);
    expect(km).toBeLessThan(3.4);
    expect(etaMinutes(km)).toBe(10);
  });

  it('al estar cerca la llegada mínima es 1 minuto', () => {
    expect(etaMinutes(0.05)).toBe(1);
  });
});

describe('retraso del profesional', () => {
  const salida = '2026-11-03T15:00:00.000Z';

  it('usa la llegada estimada con la primera ubicación', () => {
    const service = { on_the_way_at: salida, expected_arrival_at: '2026-11-03T15:20:00.000Z' };
    expect(arrivalDeadline(service)?.toISOString()).toBe('2026-11-03T15:20:00.000Z');
    // Margen de 10 minutos antes de avisar.
    expect(isLate(service, new Date('2026-11-03T15:29:00.000Z'))).toBe(false);
    expect(isLate(service, new Date('2026-11-03T15:31:00.000Z'))).toBe(true);
  });

  it('sin ubicación compartida asume una hora de camino', () => {
    const service = { on_the_way_at: salida, expected_arrival_at: null };
    expect(isLate(service, new Date('2026-11-03T16:05:00.000Z'))).toBe(false);
    expect(isLate(service, new Date('2026-11-03T16:11:00.000Z'))).toBe(true);
  });

  it('sin hora de salida no avisa', () => {
    expect(isLate({ on_the_way_at: null, expected_arrival_at: null })).toBe(false);
  });
});
