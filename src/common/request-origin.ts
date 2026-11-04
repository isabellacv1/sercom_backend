import { AsyncLocalStorage } from 'node:async_hooks';

/**
 * Dirección (Origin) desde la que llegó la petición actual. Sirve para que,
 * tras pagar en Wompi, el usuario vuelva a la misma dirección de la app en
 * la que tiene la sesión abierta (cada dominio guarda su propia sesión).
 */
const storage = new AsyncLocalStorage<string | undefined>();

/** Middleware de Express: guarda el Origin durante la petición. */
export function requestOriginMiddleware(
  req: { headers: Record<string, string | string[] | undefined> },
  _res: unknown,
  next: () => void,
) {
  const origin = req.headers.origin;
  storage.run(typeof origin === 'string' ? origin : undefined, next);
}

/** Direcciones de la app a las que se puede volver después de pagar. */
export function allowedFrontendOrigins(): string[] {
  const extra = (process.env.PAYMENTS_ALLOWED_ORIGINS ?? '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
  return [
    'https://sercom-app.vercel.app',
    'https://sercom-frontend.vercel.app',
    process.env.PAYMENTS_FRONTEND_URL ?? '',
    ...extra,
  ]
    .filter(Boolean)
    .map((s) => s.replace(/\/+$/, ''));
}

/**
 * URL de regreso de Wompi: la dirección desde la que se pagó si es una de las
 * de SERCOM; si no, la configurada por defecto.
 */
export function paymentRedirectUrl(fallback: string, origin = storage.getStore()): string {
  const clean = origin?.replace(/\/+$/, '');
  return clean && allowedFrontendOrigins().includes(clean) ? clean : fallback;
}
