import { withinWarranty } from './support.service';

describe('garantía para reportar un problema', () => {
  const completed = '2026-10-01T12:00:00Z';
  const at = (iso: string) => new Date(iso).getTime();

  it('7 días sin Plus', () => {
    expect(withinWarranty(completed, 7, at('2026-10-08T11:00:00Z'))).toBe(true);
    expect(withinWarranty(completed, 7, at('2026-10-09T12:00:00Z'))).toBe(false);
  });

  it('30 días con Plus', () => {
    expect(withinWarranty(completed, 30, at('2026-10-25T12:00:00Z'))).toBe(true);
  });

  it('servicios sin fecha de cierre siempre se pueden reportar', () => {
    expect(withinWarranty(null, 7)).toBe(true);
  });
});
