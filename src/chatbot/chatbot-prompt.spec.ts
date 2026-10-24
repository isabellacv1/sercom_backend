import { ConfigService } from '@nestjs/config';
import { buildSystemPrompt } from './utils/chatbot-prompts';
import { GeminiProvider } from './providers/gemini.provider';

const fees = { clientFeePct: 5, workerFeePct: 10, proFeePct: 7, plusPrice: 14900, proPrice: 39900 };

describe('prompt del asistente', () => {
  it('usa el catálogo real y el contexto del usuario', () => {
    const prompt = buildSystemPrompt(
      { Carpintería: ['Reparación de puertas'], Plomería: ['Reparación de fugas'] },
      {
        firstName: 'Ana',
        role: 'client',
        isPlus: true,
        isPro: false,
        services: [{ title: 'Limpieza hogar', status: 'on_the_way', payment: 'held' }],
      },
      fees,
    );
    expect(prompt).toContain('Carpintería:\n- Reparación de puertas');
    expect(prompt).toContain('Nombre: Ana');
    expect(prompt).toContain('SERCOM Plus: sí');
    expect(prompt).toContain('"Limpieza hogar": profesional en camino, pago en custodia');
  });
});

describe('respuesta del asistente', () => {
  const provider = new GeminiProvider({ get: () => 'test-key' } as unknown as ConfigService) as any;

  it('limpia sugerencias y solo acepta acciones conocidas', () => {
    const r = provider.buildSafeResponse({
      reply: 'Listo',
      suggestions: ['Es urgente', '', 42, 'Calle 5', 'Otra', 'Sobra'],
      action: 'borrar_todo',
    });
    expect(r.suggestions).toEqual(['Es urgente', 'Calle 5', 'Otra']);
    expect(r.action).toBeNull();
  });

  it('una solicitud lista sugiere crear el servicio', () => {
    const r = provider.buildSafeResponse({
      reply: 'Tengo todo',
      readyToCreate: true,
      missionDraft: { category: 'Plomería', serviceType: 'Reparación de fugas', description: 'x', location: 'y' },
    });
    expect(r.readyToCreate).toBe(true);
    expect(r.action).toBe('create_service');
  });
});
