import { BadRequestException, ForbiddenException } from '@nestjs/common';
import { ServiceEvidenceService } from './service-evidence.service';
import { ServicesService } from './services.service';

const photo = (over: Record<string, unknown> = {}) =>
  ({
    originalname: 'baño listo.jpg',
    mimetype: 'image/jpeg',
    size: 1000,
    buffer: Buffer.from('x'),
    ...over,
  }) as never;

/** Supabase mínimo: un servicio y un conteo de evidencia configurables. */
function setup(service: Record<string, unknown>, evidenceCount = 0) {
  const upload = jest.fn().mockResolvedValue({ error: null });
  const insert = jest.fn().mockResolvedValue({ error: null });
  const query = (table: string) => {
    const q: any = {
      select: () => q,
      eq: () => q,
      order: () => Promise.resolve({ data: [], error: null }),
      maybeSingle: () =>
        Promise.resolve({ data: table === 'services' ? service : null, error: null }),
      insert,
      then: (res: any) => res({ count: evidenceCount, error: null }),
    };
    return q;
  };
  const supabase = {
    sbRaw: { from: query },
    client: { storage: { from: () => ({ upload, createSignedUrls: jest.fn() }) } },
  };
  return { evidence: new ServiceEvidenceService(supabase as never), upload, insert };
}

const inProgress = {
  id: 'svc',
  client_id: 'client',
  assigned_worker_id: 'worker',
  status: 'in_progress',
};

describe('ServiceEvidenceService', () => {
  it('el técnico asignado sube fotos con el servicio en ejecución', async () => {
    const { evidence, upload, insert } = setup(inProgress);
    await evidence.upload('worker', 'svc', [photo()]);
    expect(upload).toHaveBeenCalledWith(
      expect.stringMatching(/^svc\/\d+-bano_listo\.jpg$/),
      expect.any(Buffer),
      expect.objectContaining({ contentType: 'image/jpeg' }),
    );
    expect(insert).toHaveBeenCalled();
  });

  it('rechaza a quien no es el técnico asignado', async () => {
    const { evidence } = setup(inProgress);
    await expect(evidence.upload('client', 'svc', [photo()])).rejects.toBeInstanceOf(ForbiddenException);
  });

  it('rechaza si el servicio no está en ejecución', async () => {
    const { evidence } = setup({ ...inProgress, status: 'on_the_way' });
    await expect(evidence.upload('worker', 'svc', [photo()])).rejects.toBeInstanceOf(BadRequestException);
  });

  it('solo acepta imágenes', async () => {
    const { evidence } = setup(inProgress);
    await expect(
      evidence.upload('worker', 'svc', [photo({ mimetype: 'application/pdf' })]),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('no supera el máximo de fotos por servicio', async () => {
    const { evidence } = setup(inProgress, 10);
    await expect(evidence.upload('worker', 'svc', [photo()])).rejects.toBeInstanceOf(BadRequestException);
  });
});

describe('ServicesService.updateStatus → completed', () => {
  const make = (evidenceCount: number) => {
    const sb: any = {
      from: () => sb,
      select: () => sb,
      eq: () => sb,
      maybeSingle: () => Promise.resolve({ data: { ...inProgress }, error: null }),
    };
    const evidence = { count: jest.fn().mockResolvedValue(evidenceCount) };
    return new ServicesService({ sb } as never, {} as never, evidence as never);
  };

  it('no deja finalizar sin evidencia', async () => {
    await expect(make(0).updateStatus('worker', 'svc', 'completed')).rejects.toThrow(
      'Adjunta al menos una foto del trabajo realizado para finalizar',
    );
  });
});
