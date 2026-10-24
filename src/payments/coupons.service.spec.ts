import { BadRequestException } from '@nestjs/common';
import { CouponsService } from './coupons.service';

/** Supabase en memoria: filtros eq/in/neq, maybeSingle y conteos (head). */
function fakeDb(tables: Record<string, any[]>) {
  return {
    from(table: string) {
      const rows = tables[table] ?? [];
      const filters: ((r: any) => boolean)[] = [];
      let head = false;
      const q: any = {
        select: (_: string, opts?: { head?: boolean }) => ((head = !!opts?.head), q),
        eq: (c: string, v: any) => (filters.push((r) => r[c] === v), q),
        neq: (c: string, v: any) => (filters.push((r) => r[c] !== v), q),
        in: (c: string, v: any[]) => (filters.push((r) => v.includes(r[c])), q),
        maybeSingle: () =>
          Promise.resolve({ data: rows.filter((r) => filters.every((f) => f(r)))[0] ?? null, error: null }),
        then: (resolve: any) => {
          const found = rows.filter((r) => filters.every((f) => f(r)));
          return resolve(head ? { count: found.length, error: null } : { data: found, error: null });
        },
      };
      return q;
    },
  };
}

const coupon = (over: Record<string, unknown> = {}) => ({
  id: 'c1',
  code: 'BIENVENIDO',
  discount_type: 'percent',
  discount_value: 20,
  max_discount: 30000,
  min_amount: 0,
  first_service_only: true,
  category_id: null,
  starts_at: null,
  ends_at: null,
  max_redemptions: null,
  max_per_user: 1,
  active: true,
  ...over,
});

const make = (coupons: any[], payments: any[] = []) =>
  new CouponsService({ sbRaw: fakeDb({ coupons, payments }) } as any);

const args = (over: Record<string, unknown> = {}) => ({
  code: ' bienvenido ',
  clientId: 'client',
  categoryId: null,
  baseAmount: 105000,
  paymentId: 'p-new',
  ...over,
});

describe('CouponsService', () => {
  it('20% con tope: 105.000 → 21.000 de descuento; 200.000 → tope de 30.000', async () => {
    expect((await make([coupon()]).evaluate(args())).discount).toBe(21000);
    expect((await make([coupon()]).evaluate(args({ baseAmount: 200000 }))).discount).toBe(30000);
  });

  it('BIENVENIDO solo aplica si el cliente no ha pagado otro servicio', async () => {
    const paidBefore = [{ id: 'p-old', client_id: 'client', status: 'released', coupon_code: null }];
    await expect(make([coupon()], paidBefore).evaluate(args())).rejects.toThrow(
      'Este cupón es solo para tu primer servicio',
    );
  });

  it('rechaza cupones vencidos, inexistentes o de otra categoría', async () => {
    await expect(
      make([coupon({ ends_at: '2020-01-01T00:00:00Z', first_service_only: false })]).evaluate(args()),
    ).rejects.toThrow('Este cupón ya venció');
    await expect(make([]).evaluate(args())).rejects.toBeInstanceOf(BadRequestException);
    await expect(
      make([coupon({ category_id: 'techos', first_service_only: false })]).evaluate(args({ categoryId: 'pintura' })),
    ).rejects.toThrow('no aplica para esta categoría');
  });

  it('un uso por persona: ya lo usó en un pago anterior', async () => {
    const used = [{ id: 'p-old', client_id: 'client', status: 'held', coupon_code: 'LLUVIAS' }];
    await expect(
      make([coupon({ code: 'LLUVIAS', first_service_only: false })], used).evaluate(args({ code: 'lluvias' })),
    ).rejects.toThrow('Ya usaste este cupón');
  });
});
