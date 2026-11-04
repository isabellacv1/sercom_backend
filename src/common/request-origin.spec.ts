import { paymentRedirectUrl } from './request-origin';

describe('regreso después de pagar', () => {
  const fallback = 'https://sercom-frontend.vercel.app';

  it('vuelve a la dirección de SERCOM desde la que se pagó', () => {
    expect(paymentRedirectUrl(fallback, 'https://sercom-app.vercel.app')).toBe('https://sercom-app.vercel.app');
    expect(paymentRedirectUrl(fallback, 'https://sercom-frontend.vercel.app/')).toBe(fallback);
  });

  it('ignora direcciones ajenas o vacías', () => {
    expect(paymentRedirectUrl(fallback, 'https://evil.example.com')).toBe(fallback);
    expect(paymentRedirectUrl(fallback, undefined)).toBe(fallback);
  });
});
