import { distanceKm, etaMinutes } from './live-location.service';

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
