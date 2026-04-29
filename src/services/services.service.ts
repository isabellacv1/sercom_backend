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
export type ServiceStatus = Database['public']['Enums']['service_status'];

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

  async confirmCompletion(userId: string, serviceId: string) {
    // 1. Obtener el servicio
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

    // 2. Validar que el servicio no esté ya cancelado o completado
    if (service.status === 'cancelled' || service.status === 'completed') {
      throw new BadRequestException(
        'No se puede confirmar un servicio cancelado o que ya está finalizado',
      );
    }

    // 3. Determinar rol y preparar actualización
    let updatePayload: any = {};
    let isClient = false;
    let isWorker = false;

    if (service.client_id === userId) {
      isClient = true;
      updatePayload = { client_confirmation: true };
    } else if (service.assigned_worker_id === userId) {
      isWorker = true;
      updatePayload = { worker_confirmation: true };
    } else {
      throw new ForbiddenException(
        'Solo el cliente o el trabajador asignado pueden confirmar el servicio',
      );
    }

    // 4. Actualizar en Supabase. El trigger se encarga de cambiar el status a 'completed'
    // si ambas confirmaciones son true y liberar el pago.
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

    return {
      message: `Confirmación de ${isClient ? 'cliente' : 'trabajador'} registrada exitosamente.`,
      service: updatedService,
    };
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

    return (data || []).map((service: any) => ({
      ...service,
      escrow_ui_message: this.getEscrowUiMessage(service),
    }));
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

    return {
      ...data,
      escrow_ui_message: this.getEscrowUiMessage(data),
    };
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

  async findMissions(statusFilter: string, userId: string): Promise<any[]> {
    let query = this.supabaseService.sb
      .from('services')
      .select(`
        *,
        category:service_categories(id, name, description, icon),
        proposals:proposals(count)
      `);

    if (statusFilter === 'active') {
      query = query.eq('status', 'requested');
    } else if (statusFilter === 'in_progress') {
      query = query
        .or('status.eq.assigned,status.eq.on_the_way,status.eq.in_progress')
        .eq('assigned_worker_id', userId);
    } else if (statusFilter === 'history') {
      query = query.eq('assigned_worker_id', userId).eq('status', 'completed');
    }

    const { data, error } = await query.order('created_at', { ascending: false });

    if (error) {
      throw new InternalServerErrorException(error.message);
    }

    return data.map((service: any) => {
      const proposalsCount = service.proposals?.[0]?.count ?? 0;
      return {
        ...service,
        price_min: service.budget_min,
        price_max: service.budget_max,
        category_name: service.category?.name || 'General',
        proposals_count: proposalsCount,
        offer_count: proposalsCount,
        status_label: this.getStatusLabel(service.status),
        created_at_relative: this.getRelativeTime(new Date(service.created_at)),
        worker_confirmation: service.worker_confirmation,
        client_confirmation: service.client_confirmation,
        escrow_ui_message: this.getEscrowUiMessage(service),
      };
    });
  }

  private getEscrowUiMessage(service: any): string {
    if (service.status === 'completed') {
      return 'Servicio finalizado y fondos liberados';
    }
    if (service.worker_confirmation === true && service.client_confirmation === false) {
      return 'Esperando que confirmes para liberar el pago';
    }
    if (service.worker_confirmation === false && service.client_confirmation === true) {
      return 'Esperando que el trabajador confirme la finalización';
    }
    if (service.worker_confirmation === false && service.client_confirmation === false && service.status === 'in_progress') {
      return 'Servicio en ejecución';
    }
    return 'Estado pendiente';
  }

  private getStatusLabel(serviceStatus: ServiceStatus): string {
    const labels: Record<ServiceStatus, string> = {
      requested: 'Recibiendo postulaciones',
      assigned: 'Asignada',
      on_the_way: 'En camino',
      in_progress: 'En ejecución',
      completed: 'Completada',
      cancelled: 'Cancelada',
      draft: 'Borrador',
    };
    return labels[status] || status;
  }

  private getRelativeTime(date: Date): string {
    const now = new Date();
    const diffInSeconds = Math.floor((now.getTime() - date.getTime()) / 1000);

    if (diffInSeconds < 60) return 'Hace un momento';
    const mins = Math.floor(diffInSeconds / 60);
    if (mins < 60) return `Hace ${mins} min`;
    const hours = Math.floor(mins / 60);
    if (hours < 24) return `Hace ${hours} horas`;
    const days = Math.floor(hours / 24);
    return `Hace ${days} días`;
  }
}