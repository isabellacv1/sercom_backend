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
import { Database } from '../types/supabase';

type ServiceUpdate = Database['public']['Tables']['services']['Update'];
type ServiceStatus = Database['public']['Enums']['service_status'];

@Injectable()
export class ServicesService {
  constructor(private readonly supabaseService: SupabaseService) {}

  async createPreRequest(
    clientId: string,
    dto: CreatePreServiceRequestDto,
  ) {
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

    const candidateWorkers = await this.findCandidateWorkers(clientId, serviceId);

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
      .contains('roles', ['worker'])
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
        active_role,
        roles
      ),
      category:service_categories(
        id,
        name
      )
    `)
    .eq('category_id', service.category_id)
    .eq('is_active', true);

  const workers = workersResponse.data;
  const workersError = workersResponse.error;

  if (workersError) {
    throw new InternalServerErrorException(workersError.message);
  }

const filteredWorkers =
  workers?.filter((item: any) => {
    const worker = item.worker;

    if (!worker) return false;
    if (worker.active_role !== 'worker') return false;
    if (!worker.is_active) return false;
    if (worker.status !== 'verified') return false;

    if (service.city && worker.city) {
      return (
        worker.city.trim().toLowerCase() ===
        service.city.trim().toLowerCase()
      );
    }

    return true;
  }) ?? [];

  return {
    service_id: service.id,
    category_id: service.category_id,
    service_option_id: service.service_option_id,
    city: service.city,
    candidates: filteredWorkers,
  };
}
}