import {
  Injectable,
  InternalServerErrorException,
  Logger,
  NotFoundException,
} from '@nestjs/common';

import { GeminiProvider } from './providers/gemini.provider';
import { SupabaseService } from '../supabase/supabase.service';
import { ResolveDraftDto } from './dto/resolve-draft.dto';
import { buildSystemPrompt, ChatbotUserContext } from './utils/chatbot-prompts';
import { getFeeRates } from '../payments/fees';
import { getPlusConfig, getProConfig, isPlusClient, isProWorker } from '../memberships/pro';

const CATALOG_TTL_MS = 10 * 60 * 1000;

@Injectable()
export class ChatbotService {
  private readonly logger = new Logger(ChatbotService.name);

  constructor(
    private readonly geminiProvider: GeminiProvider,
    private readonly supabaseService: SupabaseService,
  ) {}

  private catalogCache?: { at: number; catalog: Record<string, string[]> };

  async processMessage(userId: string, messages: any[]) {
    const [catalog, user] = await Promise.all([this.catalog(), this.userContext(userId)]);
    const rates = getFeeRates();
    const prompt = buildSystemPrompt(catalog, user, {
      clientFeePct: Math.round(rates.clientFeeRate * 100),
      workerFeePct: Math.round(rates.workerCommissionRate * 100),
      proFeePct: Math.round(getProConfig().workerCommissionRate * 100),
      plusPrice: getPlusConfig().monthlyPrice,
      proPrice: getProConfig().monthlyPrice,
    });
    return this.geminiProvider.generateResponse(prompt, messages);
  }

  /** Categorías y servicios activos de la BD (caché de 10 minutos). */
  private async catalog(): Promise<Record<string, string[]>> {
    if (this.catalogCache && Date.now() - this.catalogCache.at < CATALOG_TTL_MS) {
      return this.catalogCache.catalog;
    }
    const db = this.supabaseService.sbRaw;
    const [{ data: categories }, { data: options }] = await Promise.all([
      db.from('service_categories').select('id, name').eq('is_active', true),
      db.from('service_options').select('category_id, title').eq('is_active', true),
    ]);
    const catalog: Record<string, string[]> = {};
    for (const c of categories ?? []) {
      catalog[c.name] = (options ?? [])
        .filter((o: any) => o.category_id === c.id)
        .map((o: any) => o.title);
    }
    this.catalogCache = { at: Date.now(), catalog };
    return catalog;
  }

  /** Quién escribe: nombre, modo, membresía y sus últimos servicios. */
  private async userContext(userId: string): Promise<ChatbotUserContext> {
    const db = this.supabaseService.sbRaw;
    const { data: profile } = await db
      .from('profiles')
      .select('full_name, active_role')
      .eq('id', userId)
      .maybeSingle();
    const role = profile?.active_role === 'worker' ? 'worker' : 'client';
    const column = role === 'worker' ? 'assigned_worker_id' : 'client_id';

    const [{ data: services }, isPlus, isPro] = await Promise.all([
      db
        .from('services')
        .select('title, status, payments(status)')
        .eq(column, userId)
        .order('created_at', { ascending: false })
        .limit(5),
      isPlusClient(db, userId),
      isProWorker(db, userId),
    ]);

    return {
      firstName: profile?.full_name?.split(' ')[0] ?? null,
      role,
      isPlus,
      isPro,
      services: (services ?? []).map((s: any) => ({
        title: s.title ?? 'Servicio',
        status: s.status,
        payment: (Array.isArray(s.payments) ? s.payments[0]?.status : s.payments?.status) ?? null,
      })),
    };
  }

  async resolveDraft(dto: ResolveDraftDto) {
    const normalizedCategory = this.normalize(dto.category);
    const normalizedServiceType = this.normalize(dto.serviceType);

    this.logger.log(
      `Resolviendo draft: category="${dto.category}" → normalizado="${normalizedCategory}", serviceType="${dto.serviceType}" → normalizado="${normalizedServiceType}"`,
    );

    // Cargar todas las categorías activas y hacer match por normalización
    const { data: categories, error: catError } =
      await this.supabaseService.sb
        .from('service_categories')
        .select('id, name')
        .eq('is_active', true);

    if (catError) {
      throw new InternalServerErrorException(catError.message);
    }

    const category = categories?.find(
      (c) => this.normalize(c.name) === normalizedCategory,
    );

    if (!category) {
      const available = categories?.map((c) => c.name).join(', ') ?? '';
      this.logger.warn(
        `Categoría no encontrada: "${dto.category}". Disponibles: ${available}`,
      );
      throw new NotFoundException(
        `Categoría "${dto.category}" no encontrada. Categorías disponibles: ${available}`,
      );
    }

    // Cargar todas las opciones de la categoría y hacer match por normalización
    const { data: options, error: optError } =
      await this.supabaseService.sb
        .from('service_options')
        .select('id, category_id, title')
        .eq('category_id', category.id)
        .eq('is_active', true);

    if (optError) {
      throw new InternalServerErrorException(optError.message);
    }

    const serviceOption = options?.find(
      (o) => this.normalize(o.title) === normalizedServiceType,
    );

    if (!serviceOption) {
      const available = options?.map((o) => o.title).join(', ') ?? 'ninguno';
      this.logger.warn(
        `Servicio no encontrado: "${dto.serviceType}" en categoría "${category.name}". Disponibles: ${available}`,
      );
      throw new NotFoundException(
        `Servicio "${dto.serviceType}" no encontrado en categoría "${category.name}". Servicios disponibles: ${available}`,
      );
    }

    this.logger.log(
      `Draft resuelto: categoryId=${category.id} (${category.name}), serviceOptionId=${serviceOption.id} (${serviceOption.title})`,
    );

    return {
      categoryId: category.id,
      categoryName: category.name,
      serviceOptionId: serviceOption.id,
      serviceOptionTitle: serviceOption.title,
    };
  }

  /**
   * Normaliza texto para comparaciones robustas:
   * - Convierte a minúsculas
   * - Elimina tildes y diacríticos
   * - Elimina espacios extras
   */
  private normalize(text: string): string {
    return text
      .toLowerCase()
      .normalize('NFD')
      .replace(/[̀-ͯ]/g, '')
      .replace(/\s+/g, ' ')
      .trim();
  }
}
