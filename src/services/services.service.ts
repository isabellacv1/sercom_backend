import {
  BadRequestException,
  Injectable,
  ForbiddenException,
  InternalServerErrorException,
  NotFoundException,
} from '@nestjs/common';
import { SupabaseService } from '../supabase/supabase.service';
import { CreateServiceDto } from './dto/create-service.dto';
import { CreatePreServiceRequestDto } from './dto/create-pre-service-request.dto';
import { UpdatePreServiceRequestDetailsDto } from './dto/update-pre-service-request-details.dto';
import { FindOpportunitiesQueryDto } from './dto/find-opportunities-query.dto';
import { Database } from '../types/supabase';

type ServiceUpdate = Database['public']['Tables']['services']['Update'];
type ServiceStatus = Database['public']['Enums']['service_status'];

type CandidateWorkerProfile = Pick<
  Database['public']['Tables']['profiles']['Row'],
  | 'id'
  | 'full_name'
  | 'email'
  | 'city'
  | 'rating_avg'
  | 'rating_count'
  | 'profile_image_url'
  | 'is_active'
  | 'status'
  | 'role'
>;

type WorkerSkillCandidateJoin = Pick<
  Database['public']['Tables']['worker_skills']['Row'],
  'id' | 'years_experience' | 'base_price' | 'is_active'
> & {
  worker: CandidateWorkerProfile;
  category: Pick<
    Database['public']['Tables']['service_categories']['Row'],
    'id' | 'name'
  > | null;
};

function isWorkerSkillCandidateJoin(
  value: unknown,
): value is WorkerSkillCandidateJoin {
  if (typeof value !== 'object' || value === null) {
    return false;
  }
  if (!('worker' in value)) {
    return false;
  }
  const workerUnknown = (value as { worker: unknown }).worker;
  if (typeof workerUnknown !== 'object' || workerUnknown === null) {
    return false;
  }
  const p = workerUnknown as Record<string, unknown>;
  return (
    typeof p.id === 'string' &&
    typeof p.full_name === 'string' &&
    typeof p.email === 'string' &&
    (p.city === null || typeof p.city === 'string') &&
    (p.rating_avg === null || typeof p.rating_avg === 'number') &&
    (p.rating_count === null || typeof p.rating_count === 'number') &&
    (p.profile_image_url === null || typeof p.profile_image_url === 'string') &&
    typeof p.is_active === 'boolean' &&
    typeof p.status === 'string' &&
    typeof p.role === 'string'
  );
}

@Injectable()
export class ServicesService {
  constructor(private readonly supabaseService: SupabaseService) {}

  async createPreRequest(clientId: string, dto: CreatePreServiceRequestDto) {
    const categoryResponse = await this.supabaseService.sb
      .from('service_categories')
      .select('id, name, description, icon, is_active')
      .eq('id', dto.category_id)
      .eq('is_active', true)
      .maybeSingle();

    const category = categoryResponse.data;
    const categoryError = categoryResponse.error;

    if (categoryError) {
      throw new InternalServerErrorException(categoryError.message);
    }

    if (!category) {
      throw new NotFoundException('Categoria de servicio no encontrada');
    }

    const draftTitle = dto.title?.trim() || `Pre-solicitud de ${category.name}`;

    const createResponse = await this.supabaseService.sb
      .from('services')
      .insert({
        client_id: clientId,
        category_id: dto.category_id,
        title: draftTitle,
        description:
          'Pre-solicitud creada. Pendiente completar ubicacion, fecha y urgencia.',
        address: 'Pendiente por definir',
        city: null,
        latitude: null,
        longitude: null,
        scheduled_at: null,
        urgency_level: null,
        status: 'draft',
      })
      .select(
        `
        *,
        category:service_categories(id, name, description, icon)
      `,
      )
      .single();

    const data = createResponse.data;
    const error = createResponse.error;

    if (error) {
      throw new InternalServerErrorException(error.message);
    }

    if (!data) {
      throw new InternalServerErrorException(
        'No se pudo crear la pre-solicitud',
      );
    }

    const historyResponse = await this.supabaseService.sb
      .from('service_status_history')
      .insert({
        service_id: data.id,
        status: 'draft',
        changed_by: clientId,
        note: `Pre-solicitud creada para la categoria ${category.name}`,
      });

    const historyError = historyResponse.error;

    if (historyError) {
      throw new InternalServerErrorException(historyError.message);
    }

    return {
      message: 'Pre-solicitud creada exitosamente',
      service: data,
      required_fields: ['address', 'scheduled_at', 'urgency_level'],
    };
  }

  async updatePreRequestDetails(
    clientId: string,
    serviceId: string,
    dto: UpdatePreServiceRequestDetailsDto,
  ) {
    const serviceResponse = await this.supabaseService.sb
      .from('services')
      .select(
        `
        *,
        category:service_categories(id, name, description, icon)
      `,
      )
      .eq('id', serviceId)
      .eq('client_id', clientId)
      .maybeSingle();

    const service = serviceResponse.data;
    const serviceError = serviceResponse.error;

    if (serviceError) {
      throw new InternalServerErrorException(serviceError.message);
    }

    if (!service) {
      throw new NotFoundException('Pre-solicitud no encontrada');
    }

    if (service.status !== 'draft') {
      throw new BadRequestException(
        'Solo puedes completar solicitudes en estado draft',
      );
    }

    const updateResponse = await this.supabaseService.sb
      .from('services')
      .update({
        address: dto.address,
        city: dto.city ?? null,
        scheduled_at: dto.scheduled_at,
        urgency_level: dto.urgency_level,
        title: dto.title?.trim() || service.title,
        description:
          dto.description?.trim() ||
          service.description ||
          'Solicitud lista para ser publicada',
        status: 'requested',
      })
      .eq('id', serviceId)
      .select(
        `
        *,
        category:service_categories(id, name, description, icon)
      `,
      )
      .single();

    const updatedService = updateResponse.data;
    const updateError = updateResponse.error;

    if (updateError) {
      throw new InternalServerErrorException(updateError.message);
    }

    const historyResponse = await this.supabaseService.sb
      .from('service_status_history')
      .insert({
        service_id: serviceId,
        status: 'requested',
        changed_by: clientId,
        note: `Pre-solicitud completada con urgencia ${dto.urgency_level}`,
      });

    const historyError = historyResponse.error;

    if (historyError) {
      throw new InternalServerErrorException(historyError.message);
    }

    const candidateWorkers = await this.findCandidateWorkers(
      clientId,
      serviceId,
    );

    return {
      message: 'Pre-solicitud completada exitosamente',
      service: updatedService,
      candidate_workers: candidateWorkers.candidates,
      total_candidates: candidateWorkers.candidates.length,
    };
  }

  async findStatusHistory(userId: string, serviceId: string) {
    const serviceResponse = await this.supabaseService.sb
      .from('services')
      .select('*')
      .eq('id', serviceId)
      .maybeSingle();

    const service = serviceResponse.data;
    const serviceError = serviceResponse.error;

    if (serviceError) {
      throw new InternalServerErrorException(serviceError.message);
    }

    if (!service) {
      throw new NotFoundException('Servicio no encontrado');
    }

    const isParticipant =
      service.client_id === userId || service.assigned_worker_id === userId;

    if (!isParticipant) {
      throw new ForbiddenException(
        'No tienes permisos para ver el historial de este servicio',
      );
    }

    const historyResponse = await this.supabaseService.sb
      .from('service_status_history')
      .select('*')
      .eq('service_id', serviceId)
      .order('created_at', { ascending: true });

    const history = historyResponse.data;
    const historyError = historyResponse.error;

    if (historyError) {
      throw new InternalServerErrorException(historyError.message);
    }

    return history;
  }

  async updateStatus(
    workerId: string,
    serviceId: string,
    nextStatus: 'on_the_way' | 'in_progress' | 'completed',
  ) {
    const serviceResponse = await this.supabaseService.sb
      .from('services')
      .select('*')
      .eq('id', serviceId)
      .maybeSingle();

    const service = serviceResponse.data;
    const serviceError = serviceResponse.error;

    if (serviceError) {
      throw new InternalServerErrorException(serviceError.message);
    }

    if (!service) {
      throw new NotFoundException('Servicio no encontrado');
    }

    if (service.assigned_worker_id !== workerId) {
      throw new ForbiddenException(
        'Solo el trabajador asignado puede actualizar el estado',
      );
    }

    if (service.status === 'cancelled' || service.status === 'completed') {
      throw new BadRequestException(
        'No se puede actualizar un servicio cancelado o finalizado',
      );
    }

    if (!this.isValidStatusTransition(service.status, nextStatus)) {
      throw new BadRequestException(
        `Transición inválida de ${service.status} a ${nextStatus}`,
      );
    }

    const updatePayload: ServiceUpdate = {
      status: nextStatus,
    };

    if (nextStatus === 'completed') {
      updatePayload.completed_at = new Date().toISOString();
    }

    const updateResponse = await this.supabaseService.sb
      .from('services')
      .update(updatePayload)
      .eq('id', serviceId)
      .select()
      .single();

    const updatedService = updateResponse.data;
    const updateError = updateResponse.error;

    if (updateError) {
      throw new InternalServerErrorException(updateError.message);
    }

    return updatedService;
  }

  private isValidStatusTransition(
    currentStatus: ServiceStatus,
    nextStatus: ServiceStatus,
  ): boolean {
    const validTransitions: Partial<Record<ServiceStatus, ServiceStatus[]>> = {
      draft: ['requested'],
      requested: ['assigned'],
      assigned: ['on_the_way'],
      on_the_way: ['in_progress'],
      in_progress: ['completed'],
      completed: [],
      cancelled: [],
    };

    return validTransitions[currentStatus]?.includes(nextStatus) ?? false;
  }

  async assignWorker(clientId: string, serviceId: string, workerId: string) {
    const serviceResponse = await this.supabaseService.sb
      .from('services')
      .select('*')
      .eq('id', serviceId)
      .eq('client_id', clientId)
      .maybeSingle();

    const service = serviceResponse.data;
    const serviceError = serviceResponse.error;

    if (serviceError) {
      throw new InternalServerErrorException(serviceError.message);
    }

    if (!service) {
      throw new NotFoundException('Servicio no encontrado');
    }

    if (service.status !== 'requested') {
      throw new BadRequestException(
        'Solo se puede asignar técnico a servicios en estado requested',
      );
    }

    const workerResponse = await this.supabaseService.sb
      .from('profiles')
      .select('*')
      .eq('id', workerId)
      .eq('role', 'worker')
      .eq('is_active', true)
      .eq('status', 'verified')
      .maybeSingle();

    const worker = workerResponse.data;
    const workerError = workerResponse.error;

    if (workerError) {
      throw new InternalServerErrorException(workerError.message);
    }

    if (!worker) {
      throw new NotFoundException('Trabajador no encontrado o no habilitado');
    }

    const updateResponse = await this.supabaseService.sb
      .from('services')
      .update({
        assigned_worker_id: workerId,
        status: 'assigned',
      })
      .eq('id', serviceId)
      .select()
      .single();

    const updatedService = updateResponse.data;
    const updateError = updateResponse.error;

    if (updateError) {
      throw new InternalServerErrorException(updateError.message);
    }

    const historyResponse = await this.supabaseService.sb
      .from('service_status_history')
      .insert({
        service_id: serviceId,
        status: 'assigned',
        changed_by: clientId,
        note: `Técnico asignado: ${workerId}`,
      });

    const historyError = historyResponse.error;

    if (historyError) {
      throw new InternalServerErrorException(historyError.message);
    }

    return updatedService;
  }

  async create(clientId: string, dto: CreateServiceDto) {
    if (
      dto.budget_min !== undefined &&
      dto.budget_max !== undefined &&
      dto.budget_min > dto.budget_max
    ) {
      throw new BadRequestException(
        'budget_min no puede ser mayor que budget_max',
      );
    }

    const categoryResponse = await this.supabaseService.sb
      .from('service_categories')
      .select('*')
      .eq('id', dto.category_id)
      .eq('is_active', true)
      .maybeSingle();

    const category = categoryResponse.data;
    const categoryError = categoryResponse.error;

    if (categoryError) {
      throw new InternalServerErrorException(categoryError.message);
    }

    if (!category) {
      throw new NotFoundException('Categoría no encontrada');
    }

    const optionResponse = await this.supabaseService.sb
      .from('service_options')
      .select('*')
      .eq('id', dto.service_option_id)
      .maybeSingle();

    const serviceOption = optionResponse.data;
    const optionError = optionResponse.error;

    if (optionError) {
      throw new InternalServerErrorException(optionError.message);
    }

    if (!serviceOption) {
      throw new NotFoundException('Opción de servicio no encontrada');
    }

    if (serviceOption.category_id !== dto.category_id) {
      throw new BadRequestException(
        'La opción de servicio no pertenece a la categoría seleccionada',
      );
    }

    const createResponse = await this.supabaseService.sb
      .from('services')
      .insert({
        client_id: clientId,
        category_id: dto.category_id,
        service_option_id: dto.service_option_id,
        title: dto.title,
        description: dto.description,
        address: dto.address,
        city: dto.city ?? null,
        latitude: dto.latitude ?? null,
        longitude: dto.longitude ?? null,
        budget_min: dto.budget_min ?? null,
        budget_max: dto.budget_max ?? null,
        scheduled_at: dto.scheduled_at ?? null,
        status: 'requested',
      })
      .select(`
        *,
        category:service_categories(id, name, description, icon),
        service_option:service_options(id, category_id, title, description, specialist_level)
      `)
      .single();

    const data = createResponse.data;
    const error = createResponse.error;

    if (error) {
      throw new InternalServerErrorException(error.message);
    }

    if (!data) {
      throw new InternalServerErrorException(
        'No se pudo crear la solicitud de servicio',
      );
    }

    const historyResponse = await this.supabaseService.sb
      .from('service_status_history')
      .insert({
        service_id: data.id,
        status: 'requested',
        changed_by: clientId,
        note: 'Servicio creado por el cliente',
      });

    const historyError = historyResponse.error;

    if (historyError) {
      throw new InternalServerErrorException(historyError.message);
    }

    const candidateWorkers = await this.findCandidateWorkers(clientId, data.id);

    return {
      message: 'Solicitud de servicio creada exitosamente',
      service: data,
      candidate_workers: candidateWorkers.candidates,
      total_candidates: candidateWorkers.candidates.length,
    };
  }

  async findMine(clientId: string) {
    const response = await this.supabaseService.sb
      .from('services')
      .select(`
        *,
        category:service_categories(id, name, description, icon),
        service_option:service_options(id, category_id, title, description, specialist_level)
      `)
      .eq('client_id', clientId)
      .order('created_at', { ascending: false });

    const data = response.data;
    const error = response.error;

    if (error) {
      throw new InternalServerErrorException(error.message);
    }

    return data;
  }

  async findOneMine(clientId: string, serviceId: string) {
    const response = await this.supabaseService.sb
      .from('services')
      .select(`
        *,
        category:service_categories(id, name, description, icon),
        service_option:service_options(id, category_id, title, description, specialist_level)
      `)
      .eq('id', serviceId)
      .eq('client_id', clientId)
      .maybeSingle();

    const data = response.data;
    const error = response.error;

    if (error) {
      throw new InternalServerErrorException(error.message);
    }

    if (!data) {
      throw new NotFoundException('Servicio no encontrado');
    }

    return data;
  }

  async findCandidateWorkers(clientId: string, serviceId: string) {
    const serviceResponse = await this.supabaseService.sb
      .from('services')
      .select('*')
      .eq('id', serviceId)
      .eq('client_id', clientId)
      .maybeSingle();

    const service = serviceResponse.data;
    const serviceError = serviceResponse.error;

    if (serviceError) {
      throw new InternalServerErrorException(serviceError.message);
    }

    if (!service) {
      throw new NotFoundException('Servicio no encontrado');
    }

    const workersResponse = await this.supabaseService.sb
      .from('worker_skills')
      .select(`
        id,
        years_experience,
        base_price,
        is_active,
        worker:profiles!worker_skills_worker_id_fkey(
          id,
          full_name,
          email,
          city,
          rating_avg,
          rating_count,
          profile_image_url,
          is_active,
          status,
          role
        ),
        category:service_categories(
          id,
          name
        )
      `)
      .eq('category_id', service.category_id)
      .eq('is_active', true);

    const workersError = workersResponse.error;

    if (workersError) {
      throw new InternalServerErrorException(workersError.message);
    }

    const workersRaw: unknown = workersResponse.data;
    const workersList: unknown[] = Array.isArray(workersRaw) ? workersRaw : [];

    const filteredWorkers = workersList.filter(
      (item): item is WorkerSkillCandidateJoin => {
        if (!isWorkerSkillCandidateJoin(item)) {
          return false;
        }
        const { worker } = item;

        if (worker.role !== 'worker') return false;
        if (!worker.is_active) return false;
        if (worker.status !== 'verified') return false;

        if (service.city && worker.city) {
          return (
            worker.city.trim().toLowerCase() ===
            service.city.trim().toLowerCase()
          );
        }

        return true;
      },
    );

    return {
      service_id: service.id,
      category_id: service.category_id,
      service_option_id: service.service_option_id,
      city: service.city,
      candidates: filteredWorkers,
    };
  }

  /**
   * Trabajos publicados (requested) sin técnico asignado, para que un trabajador explore y postule.
   * No incluye solicitudes creadas por el propio usuario.
   */
  async findOpportunities(userId: string, query: FindOpportunitiesQueryDto) {
    this.assertOpportunitiesGeoParams(query);

    const page = query.page ?? 1;
    const limit = Math.min(query.limit ?? 20, 50);
    const offset = (page - 1) * limit;

    const fullSelect = `
        *,
        category:service_categories(id, name, description, icon),
        service_option:service_options(id, category_id, title, description, specialist_level)
      `;

    const hasGeo =
      query.latitude != null &&
      query.longitude != null &&
      query.radiusKm != null;

    if (!hasGeo) {
      let q = this.supabaseService.sb
        .from('services')
        .select(fullSelect, { count: 'exact' })
        .eq('status', 'requested')
        .is('assigned_worker_id', null)
        .neq('client_id', userId)
        .order('created_at', { ascending: false });

      if (query.city?.trim()) {
        q = q.ilike('city', `%${query.city.trim()}%`);
      }

      const { data, error, count } = await q.range(offset, offset + limit - 1);

      if (error) {
        throw new InternalServerErrorException(error.message);
      }

      return {
        data: data ?? [],
        page,
        limit,
        total: count ?? 0,
      };
    }

    const { latMin, latMax, lngMin, lngMax } = this.geoBoundingBox(
      query.latitude!,
      query.longitude!,
      query.radiusKm!,
    );

    let geoQuery = this.supabaseService.sb
      .from('services')
      .select('id, latitude, longitude, created_at')
      .eq('status', 'requested')
      .is('assigned_worker_id', null)
      .neq('client_id', userId)
      .not('latitude', 'is', null)
      .not('longitude', 'is', null)
      .gte('latitude', latMin)
      .lte('latitude', latMax)
      .gte('longitude', lngMin)
      .lte('longitude', lngMax)
      .order('created_at', { ascending: false })
      .limit(2000);

    if (query.city?.trim()) {
      geoQuery = geoQuery.ilike('city', `%${query.city.trim()}%`);
    }

    const { data: candidates, error: candidatesError } = await geoQuery;

    if (candidatesError) {
      throw new InternalServerErrorException(candidatesError.message);
    }

    const withDistance =
      candidates
        ?.map((row) => ({
          id: row.id,
          distance_km: this.haversineKm(
            query.latitude!,
            query.longitude!,
            row.latitude!,
            row.longitude!,
          ),
        }))
        .filter((row) => row.distance_km <= query.radiusKm!)
        .sort((a, b) => a.distance_km - b.distance_km) ?? [];

    const total = withDistance.length;
    const truncated = (candidates?.length ?? 0) >= 2000;
    const pageSlice = withDistance.slice(offset, offset + limit);
    const ids = pageSlice.map((r) => r.id);

    if (ids.length === 0) {
      return {
        data: [],
        page,
        limit,
        total: 0,
        truncated,
      };
    }

    const { data: fullRows, error: fullError } = await this.supabaseService.sb
      .from('services')
      .select(fullSelect)
      .in('id', ids);

    if (fullError) {
      throw new InternalServerErrorException(fullError.message);
    }

    const orderMap = new Map(ids.map((id, idx) => [id, idx]));
    const sortedFull = (fullRows ?? []).slice().sort((a, b) => {
      const idA = String((a as { id: string }).id);
      const idB = String((b as { id: string }).id);
      return (orderMap.get(idA) ?? 0) - (orderMap.get(idB) ?? 0);
    });

    const data = sortedFull.map((row) => {
      const meta = pageSlice.find((p) => p.id === row.id);
      return {
        ...row,
        distance_km:
          meta?.distance_km ??
          this.haversineKm(
            query.latitude!,
            query.longitude!,
            row.latitude!,
            row.longitude!,
          ),
      };
    });

    return {
      data,
      page,
      limit,
      total,
      truncated,
    };
  }

  private assertOpportunitiesGeoParams(query: FindOpportunitiesQueryDto) {
    const hasAny =
      query.latitude != null ||
      query.longitude != null ||
      query.radiusKm != null;
    const hasAll =
      query.latitude != null &&
      query.longitude != null &&
      query.radiusKm != null;

    if (hasAny && !hasAll) {
      throw new BadRequestException(
        'Para filtrar por zona geográfica debes enviar latitude, longitude y radiusKm juntos',
      );
    }
  }

  private geoBoundingBox(lat: number, lng: number, radiusKm: number) {
    const latDelta = radiusKm / 111;
    const cosLat = Math.cos((lat * Math.PI) / 180);
    const lngDelta = radiusKm / Math.max(111 * cosLat, 0.01);

    return {
      latMin: lat - latDelta,
      latMax: lat + latDelta,
      lngMin: lng - lngDelta,
      lngMax: lng + lngDelta,
    };
  }

  private haversineKm(
    lat1: number,
    lon1: number,
    lat2: number,
    lon2: number,
  ): number {
    const R = 6371;
    const toRad = (d: number) => (d * Math.PI) / 180;
    const dLat = toRad(lat2 - lat1);
    const dLon = toRad(lon2 - lon1);
    const a =
      Math.sin(dLat / 2) ** 2 +
      Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLon / 2) ** 2;
    return 2 * R * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  }
}
