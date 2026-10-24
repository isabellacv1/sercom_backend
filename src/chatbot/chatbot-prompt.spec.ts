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

describe('modelos de respaldo de Gemini', () => {
  const make = (model?: string) =>
    new GeminiProvider({ get: (k: string) => (k === 'GEMINI_API_KEY' ? 'k' : model) } as unknown as ConfigService) as any;

  it('si el modelo configurado no existe, usa el siguiente', async () => {
    const provider = make('gemini-2.0-flash');
    const calls: string[] = [];
    provider.genAI = {
      getGenerativeModel: ({ model }: { model: string }) => ({
        generateContent: async () => {
          calls.push(model);
          if (model === 'gemini-2.0-flash') {
            throw Object.assign(new Error('models/gemini-2.0-flash is not found'), { status: 404 });
          }
          return { response: { text: () => '{"reply":"Hola","suggestions":["Sí"]}' } };
        },
      }),
    };
    const r = await provider.generateResponse('prompt', [{ text: 'hola', isUser: true }]);
    expect(calls).toEqual(['gemini-2.0-flash', 'gemini-2.5-flash']);
    expect(r.reply).toBe('Hola');
  });

  it('sin llave avisa claramente en vez de un error genérico', async () => {
    const provider = new GeminiProvider({ get: () => undefined } as unknown as ConfigService);
    await expect(provider.generateResponse('p', [])).rejects.toThrow('falta GEMINI_API_KEY');
  });
});
