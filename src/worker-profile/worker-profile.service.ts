import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  InternalServerErrorException,
  NotFoundException,
} from '@nestjs/common';
import { SupabaseService } from '../supabase/supabase.service';
import { AddPortfolioItemDto } from './dto/add-portfolio-item.dto';
import {
  SetCoverageZonesDto,
  SetWorkerSkillsDto,
  UpdateWorkerProfileDto,
  ZONE_NAMES,
  ZoneId,
} from './dto/update-worker-profile.dto';

const MAX_PORTFOLIO_ITEMS = 10;
const PORTFOLIO_BUCKET = 'user-documents';

@Injectable()
export class WorkerProfileService {
  constructor(private readonly supabaseService: SupabaseService) {}

  // ─── Helpers privados ────────────────────────────────────────────────────

  private async getVerifiedWorkerProfile(workerId: string) {
    const { data: profile, error } = await this.supabaseService.client
      .from('profiles')
      .select('id, status, roles, is_published, bio')
      .eq('id', workerId)
      .maybeSingle();

    if (error)
      throw new InternalServerErrorException('Error al obtener el perfil');
    if (!profile) throw new NotFoundException('Perfil no encontrado');
    if (!profile.roles?.includes('worker')) {
      throw new ForbiddenException('El usuario no tiene rol de trabajador');
    }
    return profile;
  }

  // ─── Bio ─────────────────────────────────────────────────────────────────

  async updateBio(workerId: string, dto: UpdateWorkerProfileDto) {
    await this.getVerifiedWorkerProfile(workerId);

    const { data, error } = await this.supabaseService.client
      .from('profiles')
      .update({ bio: dto.bio ?? null })
      .eq('id', workerId)
      .select('id, bio, is_published, status')
      .single();

    if (error)
      throw new InternalServerErrorException(
        'Error al actualizar la biografía',
      );
    return data;
  }

  // ─── Zonas de cobertura ───────────────────────────────────────────────────

  async getCoverageZones(workerId: string) {
    const { data, error } = await this.supabaseService.client
      .from('worker_coverage_zones')
      .select('id, zone_id, zone_name, created_at')
      .eq('worker_id', workerId)
      .order('zone_id');

    if (error)
      throw new InternalServerErrorException('Error al obtener las zonas');
    return data;
  }

  async setCoverageZones(workerId: string, dto: SetCoverageZonesDto) {
    await this.getVerifiedWorkerProfile(workerId);

    // Borramos las existentes y re-insertamos (replace completo)
    const { error: deleteError } = await this.supabaseService.client
      .from('worker_coverage_zones')
      .delete()
      .eq('worker_id', workerId);

    if (deleteError)
      throw new InternalServerErrorException('Error al actualizar zonas');

    const rows = dto.zone_ids.map((zone_id) => ({
      worker_id: workerId,
      zone_id,
      zone_name: ZONE_NAMES[zone_id as ZoneId],
    }));

    const { data, error } = await this.supabaseService.client
      .from('worker_coverage_zones')
      .insert(rows)
      .select('id, zone_id, zone_name');

    if (error)
      throw new InternalServerErrorException('Error al guardar las zonas');
    return data;
  }

  async getSkills(workerId: string) {
    const { data, error } = await this.supabaseService.client
      .from('worker_skills')
      .select(
        'id, category_id, years_experience, base_price, is_active, service_categories(id, name, icon)',
      )
      .eq('worker_id', workerId)
      .eq('is_active', true)
      .order('created_at', { ascending: false });

    if (error)
      throw new InternalServerErrorException('Error al obtener categorías');
    return data;
  }

  async setWorkerSkills(workerId: string, dto: SetWorkerSkillsDto) {
    await this.getVerifiedWorkerProfile(workerId);

    const categoryIds = dto.skills.map((skill) => skill.category_id);
    const uniqueCategoryIds = [...new Set(categoryIds)];

    if (uniqueCategoryIds.length !== categoryIds.length) {
      throw new BadRequestException(
        'No puedes seleccionar categorías repetidas',
      );
    }

    const { data: validCategories, error: categoriesError } =
      await this.supabaseService.client
        .from('service_categories')
        .select('id')
        .in('id', uniqueCategoryIds)
        .eq('is_active', true);

    if (categoriesError)
      throw new InternalServerErrorException('Error al validar categorías');

    const validIds = new Set(
      (validCategories ?? []).map((category) => category.id),
    );
    const invalidIds = uniqueCategoryIds.filter(
      (categoryId) => !validIds.has(categoryId),
    );

    if (invalidIds.length > 0) {
      throw new BadRequestException(
        'Una o más categorías no pertenecen al catálogo oficial activo',
      );
    }

    const { error: deleteError } = await this.supabaseService.client
      .from('worker_skills')
      .delete()
      .eq('worker_id', workerId);

    if (deleteError)
      throw new InternalServerErrorException('Error al actualizar categorías');

    const rows = dto.skills.map((skill) => ({
      worker_id: workerId,
      category_id: skill.category_id,
      years_experience: skill.years_experience ?? null,
      base_price: skill.base_price ?? null,
      is_active: true,
    }));

    const { data, error } = await this.supabaseService.client
      .from('worker_skills')
      .insert(rows)
      .select(
        'id, category_id, years_experience, base_price, is_active, service_categories(id, name, icon)',
      );

    if (error)
      throw new InternalServerErrorException('Error al guardar categorías');
    return data;
  }

  // ─── Portafolio ───────────────────────────────────────────────────────────

  async getPortfolio(workerId: string) {
    const { data, error } = await this.supabaseService.client
      .from('worker_portfolio_items')
      .select('id, file_url, file_type, title, created_at')
      .eq('worker_id', workerId)
      .order('created_at', { ascending: false });

    if (error)
      throw new InternalServerErrorException('Error al obtener el portafolio');
    return data;
  }

  async addPortfolioItem(workerId: string, dto: AddPortfolioItemDto) {
    await this.getVerifiedWorkerProfile(workerId);

    // Verificar límite de 10 items
    const { count, error: countError } = await this.supabaseService.client
      .from('worker_portfolio_items')
      .select('id', { count: 'exact', head: true })
      .eq('worker_id', workerId);

    if (countError)
      throw new InternalServerErrorException('Error al verificar portafolio');
    if ((count ?? 0) >= MAX_PORTFOLIO_ITEMS) {
      throw new BadRequestException(
        `El portafolio no puede tener más de ${MAX_PORTFOLIO_ITEMS} archivos`,
      );
    }

    const { data, error } = await this.supabaseService.client
      .from('worker_portfolio_items')
      .insert({
        worker_id: workerId,
        file_url: dto.file_url,
        file_type: dto.file_type,
        title: dto.title ?? null,
      })
      .select('id, file_url, file_type, title, created_at')
      .single();

    if (error)
      throw new InternalServerErrorException(
        'Error al agregar item al portafolio',
      );
    return data;
  }

  async uploadPortfolioFile(
    workerId: string,
    file: Express.Multer.File,
    title?: string,
  ) {
    await this.getVerifiedWorkerProfile(workerId);

    this.validatePortfolioFile(file);

    const cleanTitle = title?.trim();

    if (cleanTitle && cleanTitle.length > 80) {
      throw new BadRequestException(
        'El título no puede superar los 80 caracteres',
      );
    }

    const { count, error: countError } = await this.supabaseService.client
      .from('worker_portfolio_items')
      .select('id', { count: 'exact', head: true })
      .eq('worker_id', workerId);

    if (countError)
      throw new InternalServerErrorException('Error al verificar portafolio');
    if ((count ?? 0) >= MAX_PORTFOLIO_ITEMS) {
      throw new BadRequestException(
        `El portafolio no puede tener más de ${MAX_PORTFOLIO_ITEMS} archivos`,
      );
    }

    const fileType = this.getPortfolioFileType(file);
    const safeName = this.sanitizeFileName(file.originalname);
    const storagePath = `workers/${workerId}/portfolio/${Date.now()}-${safeName}`;
    const supabase = this.supabaseService.client;

    const upload = await supabase.storage
      .from(PORTFOLIO_BUCKET)
      .upload(storagePath, file.buffer, {
        contentType: file.mimetype,
        upsert: false,
      });

    if (upload.error) {
      throw new InternalServerErrorException(
        `Error al subir archivo de portafolio: ${upload.error.message}`,
      );
    }

    const fileUrl = supabase.storage
      .from(PORTFOLIO_BUCKET)
      .getPublicUrl(storagePath).data.publicUrl;

    const { data, error } = await this.supabaseService.client
      .from('worker_portfolio_items')
      .insert({
        worker_id: workerId,
        file_url: fileUrl,
        file_type: fileType,
        title: cleanTitle || safeName,
      })
      .select('id, file_url, file_type, title, created_at')
      .single();

    if (error)
      throw new InternalServerErrorException(
        'Error al guardar item del portafolio',
      );
    return data;
  }

  async removePortfolioItem(workerId: string, itemId: string) {
    // Verificar que el item le pertenece al worker
    const { data: item, error: findError } = await this.supabaseService.client
      .from('worker_portfolio_items')
      .select('id, worker_id')
      .eq('id', itemId)
      .maybeSingle();

    if (findError)
      throw new InternalServerErrorException('Error al buscar el item');
    if (!item) throw new NotFoundException('Item no encontrado');
    if (item.worker_id !== workerId)
      throw new ForbiddenException('No puedes eliminar este item');

    const { error } = await this.supabaseService.client
      .from('worker_portfolio_items')
      .delete()
      .eq('id', itemId);

    if (error)
      throw new InternalServerErrorException('Error al eliminar el item');
    return { message: 'Item eliminado correctamente' };
  }

  // ─── Publicar / despublicar ───────────────────────────────────────────────

  async publishProfile(workerId: string) {
    const profile = await this.getVerifiedWorkerProfile(workerId);

    // Criterio de aceptación: solo si está verified
    if (profile.status !== 'verified') {
      throw new ForbiddenException(
        'Tu perfil debe estar verificado para poder publicarlo',
      );
    }

    // Debe tener al menos una zona
    const zones = await this.getCoverageZones(workerId);
    if (!zones || zones.length === 0) {
      throw new BadRequestException(
        'Debes tener al menos una zona de cobertura para publicar',
      );
    }

    // Debe tener al menos una categoría activa (worker_skills)
    const skills = await this.getSkills(workerId);

    if (!skills || skills.length === 0) {
      throw new BadRequestException(
        'Debes tener al menos una categoría para publicar',
      );
    }

    const { data, error } = await this.supabaseService.client
      .from('profiles')
      .update({ is_published: true })
      .eq('id', workerId)
      .select('id, is_published, status, bio')
      .single();

    if (error)
      throw new InternalServerErrorException('Error al publicar el perfil');
    return data;
  }

  async unpublishProfile(workerId: string) {
    await this.getVerifiedWorkerProfile(workerId);

    const { data, error } = await this.supabaseService.client
      .from('profiles')
      .update({ is_published: false })
      .eq('id', workerId)
      .select('id, is_published, status')
      .single();

    if (error)
      throw new InternalServerErrorException('Error al despublicar el perfil');
    return data;
  }

  // ─── Vista completa del perfil del trabajador ─────────────────────────────

  async getMyWorkerProfile(workerId: string) {
    const [profileResult, zonesResult, portfolioResult, skillsResult] =
      await Promise.all([
        this.supabaseService.client
          .from('profiles')
          .select(
            'id, full_name, email, phone, profile_image_url, bio, is_published, status, rating_avg, rating_count',
          )
          .eq('id', workerId)
          .single(),
        this.getCoverageZones(workerId),
        this.getPortfolio(workerId),
        this.getSkills(workerId),
      ]);

    if (profileResult.error)
      throw new InternalServerErrorException('Error al obtener el perfil');

    return {
      profile: profileResult.data,
      coverage_zones: zonesResult,
      portfolio: portfolioResult,
      skills: skillsResult,
      can_publish:
        profileResult.data.status === 'verified' &&
        (zonesResult?.length ?? 0) > 0 &&
        (skillsResult?.length ?? 0) > 0,
    };
  }

  private validatePortfolioFile(file: Express.Multer.File) {
    const allowedMimeTypes = [
      'image/jpeg',
      'image/png',
      'image/webp',
      'video/mp4',
      'video/quicktime',
      'video/webm',
    ];

    const allowedExtensions = [
      '.jpg',
      '.jpeg',
      '.png',
      '.webp',
      '.mp4',
      '.mov',
      '.webm',
    ];
    const fileName = file.originalname.toLowerCase();
    const hasAllowedMimeType = allowedMimeTypes.includes(file.mimetype);
    const hasAllowedExtension = allowedExtensions.some((extension) =>
      fileName.endsWith(extension),
    );

    if (!hasAllowedMimeType && !hasAllowedExtension) {
      throw new BadRequestException(
        `Tipo de archivo no permitido: ${file.originalname}`,
      );
    }

    const maxSizeInBytes = 20 * 1024 * 1024;

    if (file.size > maxSizeInBytes) {
      throw new BadRequestException(
        `El archivo ${file.originalname} supera el tamaño máximo permitido de 20 MB`,
      );
    }
  }

  private getPortfolioFileType(file: Express.Multer.File): 'image' | 'video' {
    const fileName = file.originalname.toLowerCase();

    if (
      file.mimetype.startsWith('video/') ||
      fileName.endsWith('.mp4') ||
      fileName.endsWith('.mov') ||
      fileName.endsWith('.webm')
    ) {
      return 'video';
    }

    return 'image';
  }

  private sanitizeFileName(fileName: string) {
    return fileName.replace(/\s+/g, '-').replace(/[^\w.-]/g, '');
  }
}
