import {
  BadRequestException,
  HttpException,
  HttpStatus,
  Injectable,
  InternalServerErrorException,
  Logger,
  NotFoundException,
} from '@nestjs/common';

import { GeminiProvider } from './providers/gemini.provider';
import { SupabaseService } from '../supabase/supabase.service';
import { ResolveDraftDto } from './dto/resolve-draft.dto';
import { buildSystemPrompt, ChatbotUserContext } from './utils/chatbot-prompts';
import { buildPhotoQuotePrompt } from './utils/photo-quote-prompt';
import type { MulterFile } from '../common/types/multer.types';
import { getFeeRates } from '../payments/fees';
import { getPlusConfig, getProConfig, isPlusClient, isProWorker } from '../memberships/pro';

const CATALOG_TTL_MS = 10 * 60 * 1000;
const PHOTO_QUOTES_PER_DAY = 15;
const MAX_PHOTO_BYTES = 6 * 1024 * 1024;

/** Limpia la respuesta del modelo: precios enteros y razonables. */
export function sanitizePhotoQuote(raw: any) {
  const price = (v: unknown) => {
    const n = Math.round(Number(v) / 1000) * 1000;
    return Number.isFinite(n) && n > 0 ? Math.min(Math.max(n, 20000), 5000000) : null;
  };
  let min = price(raw?.price_min);
  let max = price(raw?.price_max);
  if (min && max && min > max) [min, max] = [max, min];
  if (min && !max) max = min;
  if (max && !min) min = max;
  const text = (v: unknown, len: number) => (typeof v === 'string' && v.trim() ? v.trim().slice(0, len) : null);
  const isHome = raw?.is_home_issue !== false;
  return {
    is_home_issue: isHome,
    category: isHome ? text(raw?.category, 80) : null,
    serviceType: isHome ? text(raw?.serviceType, 120) : null,
    title: text(raw?.title, 80),
    diagnosis: text(raw?.diagnosis, 400),
    description: text(raw?.description, 500),
    price_min: isHome ? min : null,
    price_max: isHome ? max : null,
    urgent: raw?.urgent === true,
    safety_warning: text(raw?.safety_warning, 300),
    tips: Array.isArray(raw?.tips) ? raw.tips.filter((t: unknown) => typeof t === 'string').slice(0, 4) : [],
    confidence: Math.min(Math.max(Number(raw?.confidence) || 0, 0), 1),
  };
}

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

  /**
   * Cotización con foto: Gemini identifica el servicio y estima el precio;
   * si SERCOM ya tiene servicios pagados en esa categoría, se agrega el
   * precio promedio real como referencia.
   */
  async photoQuote(userId: string, file: MulterFile | undefined, note?: string) {
    if (!file?.buffer?.length) throw new BadRequestException('Sube una foto del problema');
    if (!/^image\/(jpeg|png|webp|heic|heif)$/.test(file.mimetype)) {
      throw new BadRequestException('La foto debe ser JPG, PNG, WEBP o HEIC');
    }
    if (file.size > MAX_PHOTO_BYTES) throw new BadRequestException('La foto pesa más de 6 MB');

    const db = this.supabaseService.sbRaw;
    const { count } = await db
      .from('photo_quotes')
      .select('id', { count: 'exact', head: true })
      .eq('user_id', userId)
      .gt('created_at', new Date(Date.now() - 86400000).toISOString());
    if ((count ?? 0) >= PHOTO_QUOTES_PER_DAY) {
      throw new HttpException('Llegaste al límite de cotizaciones por hoy. Intenta mañana.', HttpStatus.TOO_MANY_REQUESTS);
    }

    const catalog = await this.catalog();
    const quote = sanitizePhotoQuote(
      await this.geminiProvider.analyzeImage(
        buildPhotoQuotePrompt(catalog, note),
        file.buffer.toString('base64'),
        file.mimetype,
      ),
    );

    // Solo se aceptan categoría y servicio que existan en el catálogo.
    const categoryName = Object.keys(catalog).find((c) => this.normalize(c) === this.normalize(quote.category ?? ''));
    const serviceName = categoryName
      ? catalog[categoryName].find((s) => this.normalize(s) === this.normalize(quote.serviceType ?? ''))
      : undefined;
    quote.category = categoryName ?? null;
    quote.serviceType = serviceName ?? null;

    let market: { average: number; samples: number } | null = null;
    if (categoryName) {
      const { data: rows } = await db
        .from('payments')
        .select('service_price, services:service_id!inner(service_categories:category_id!inner(name))')
        .in('status', ['held', 'released', 'disbursed'])
        .eq('services.service_categories.name', categoryName)
        .limit(200);
      const prices = (rows ?? []).map((r: any) => Number(r.service_price)).filter((n) => n > 0);
      if (prices.length >= 3) {
        market = {
          average: Math.round(prices.reduce((a, b) => a + b, 0) / prices.length / 1000) * 1000,
          samples: prices.length,
        };
      }
    }

    await db.from('photo_quotes').insert({
      user_id: userId,
      category: quote.category,
      service: quote.serviceType,
      price_min: quote.price_min,
      price_max: quote.price_max,
      urgent: quote.urgent,
    });

    return { ...quote, market_reference: market };
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
