import { ForbiddenException } from '@nestjs/common';
import { ServicesService } from './services.service';

/** El pago simulado nunca debe estar disponible en producción. */
describe('ServicesService.forcePaidForTesting', () => {
  const original = { ...process.env };
  afterEach(() => {
    process.env = { ...original };
  });

  const service = new ServicesService({ sb: {} } as never, {} as never);

  it('se bloquea con NODE_ENV=production', async () => {
    process.env.NODE_ENV = 'production';
    await expect(service.forcePaidForTesting('c', 's')).rejects.toBeInstanceOf(ForbiddenException);
  });

  it('se bloquea con ALLOW_TEST_PAYMENTS=false', async () => {
    process.env.NODE_ENV = 'development';
    process.env.ALLOW_TEST_PAYMENTS = 'false';
    await expect(service.forcePaidForTesting('c', 's')).rejects.toBeInstanceOf(ForbiddenException);
  });
});
