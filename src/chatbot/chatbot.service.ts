import {
  Injectable,
  InternalServerErrorException,
  Logger,
  NotFoundException,
} from '@nestjs/common';

import { GeminiProvider } from './providers/gemini.provider';
import { SupabaseService } from '../supabase/supabase.service';
import { ResolveDraftDto } from './dto/resolve-draft.dto';

@Injectable()
export class ChatbotService {
  private readonly logger = new Logger(ChatbotService.name);

  constructor(
    private readonly geminiProvider: GeminiProvider,
    private readonly supabaseService: SupabaseService,
  ) {}

  async processMessage(messages: any[]) {
    return await this.geminiProvider.generateResponse(messages);
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
