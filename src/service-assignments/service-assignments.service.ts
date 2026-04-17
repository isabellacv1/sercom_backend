/* eslint-disable @typescript-eslint/no-unsafe-return */
/* eslint-disable @typescript-eslint/no-unsafe-assignment */
import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  InternalServerErrorException,
  NotFoundException,
} from '@nestjs/common';
import { SupabaseService } from '../supabase/supabase.service';
import { CreateServiceAssignmentDto } from './dto/create-service-assignment.dto';
import { RespondServiceAssignmentDto } from './dto/respond-service-assignment.dto';

@Injectable()
export class ServiceAssignmentsService {
  constructor(private readonly supabaseService: SupabaseService) {}

  async create(workerId: string, dto: CreateServiceAssignmentDto) {
    const supabase = this.supabaseService.client;

    const { data: service, error: serviceError } = await supabase
      .from('services')
      .select('id, client_id, status')
      .eq('id', dto.serviceId)
      .single();

    if (serviceError || !service) {
      throw new NotFoundException('La solicitud de servicio no existe');
    }

    if (service.status !== 'requested') {
      throw new BadRequestException(
        'Solo se pueden enviar propuestas a servicios en estado requested',
      );
    }

    const { count, error: countError } = await supabase
      .from('service_assignments')
      .select('*', { count: 'exact', head: true })
      .eq('service_id', dto.serviceId);

    if (countError) {
      throw new InternalServerErrorException('Error al validar las ofertas');
    }

    if ((count ?? 0) >= 5) {
      throw new BadRequestException(
        'Esta solicitud ya alcanzo el maximo de 5 ofertas',
      );
    }

    const { data: existingOffer, error: existingOfferError } = await supabase
      .from('service_assignments')
      .select('id')
      .eq('service_id', dto.serviceId)
      .eq('worker_id', workerId)
      .maybeSingle();

    if (existingOfferError) {
      throw new InternalServerErrorException('Error al validar la oferta');
    }

    if (existingOffer) {
      throw new BadRequestException(
        'Ya enviaste una oferta para esta solicitud',
      );
    }

    const { data, error } = await supabase
      .from('service_assignments')
      .insert({
        service_id: dto.serviceId,
        worker_id: workerId,
        status: 'pending',
        proposed_price: dto.proposedPrice,
        service_description: dto.serviceDescription,
        estimated_time_minutes: dto.estimatedTimeMinutes,
        distance_km: dto.distanceKm ?? null,
        available_date: dto.availableDate,
        available_from: dto.availableFrom,
        available_to: dto.availableTo,
      })
      .select()
      .single();

    if (error) {
      throw new InternalServerErrorException(error.message);
    }

    return data;
  }

  async findByService(serviceId: string, clientId: string) {
    const supabase = this.supabaseService.client;

    const { data: service, error: serviceError } = await supabase
      .from('services')
      .select('id, client_id')
      .eq('id', serviceId)
      .single();

    if (serviceError || !service) {
      throw new NotFoundException('Servicio no encontrado');
    }

    if (service.client_id !== clientId) {
      throw new ForbiddenException(
        'No puedes ver ofertas de un servicio que no te pertenece',
      );
    }

    const { data, error } = await supabase
      .from('service_assignments')
      .select(
        `
        id,
        service_id,
        worker_id,
        status,
        proposed_price,
        service_description,
        estimated_time_minutes,
        distance_km,
        available_date,
        available_from,
        available_to,
        created_at,
        profiles:worker_id (
          id,
          full_name,
          rating_avg,
          rating_count,
          profile_image_url,
          city
        )
      `,
      )
      .eq('service_id', serviceId)
      .order('proposed_price', { ascending: true })
      .order('estimated_time_minutes', { ascending: true })
      .order('created_at', { ascending: true });

    if (error) {
      throw new InternalServerErrorException(
        'No se pudieron obtener las ofertas',
      );
    }

    const proposals =
      data?.map((item: any, index: number) => ({
        ...item,
        comparison_rank: index + 1,
      })) ?? [];

    return {
      service_id: serviceId,
      total_proposals: proposals.length,
      proposals,
    };
  }

  async respond(
    assignmentId: string,
    clientId: string,
    dto: RespondServiceAssignmentDto,
  ) {
    const supabase = this.supabaseService.client;

    const { data: assignment, error: assignmentError } = await supabase
      .from('service_assignments')
      .select(
        `
        id,
        service_id,
        worker_id,
        status,
        services:service_id (
          id,
          client_id,
          status
        )
      `,
      )
      .eq('id', assignmentId)
      .single();

    if (assignmentError || !assignment) {
      throw new NotFoundException('Oferta no encontrada');
    }

    const service = Array.isArray(assignment.services)
      ? assignment.services[0]
      : assignment.services;

    if (!service || service.client_id !== clientId) {
      throw new ForbiddenException('No puedes responder esta oferta');
    }

    if (assignment.status !== 'pending') {
      throw new BadRequestException('Esta oferta ya fue respondida');
    }

    if (dto.status === 'accepted') {
      const now = new Date().toISOString();

      const { error: acceptError } = await supabase
        .from('service_assignments')
        .update({
          status: 'accepted',
          responded_at: now,
          assigned_at: now,
        })
        .eq('id', assignmentId);

      if (acceptError) {
        throw new InternalServerErrorException('No se pudo aceptar la oferta');
      }

      const { error: rejectOthersError } = await supabase
        .from('service_assignments')
        .update({
          status: 'rejected',
          responded_at: now,
        })
        .eq('service_id', assignment.service_id)
        .neq('id', assignmentId)
        .eq('status', 'pending');

      if (rejectOthersError) {
        throw new InternalServerErrorException(
          'Se acepto la oferta, pero fallo el rechazo de las demas',
        );
      }

      const { error: serviceUpdateError } = await supabase
        .from('services')
        .update({
          status: 'assigned',
          assigned_worker_id: assignment.worker_id,
        })
        .eq('id', assignment.service_id);

      if (serviceUpdateError) {
        throw new InternalServerErrorException(
          'La oferta fue aceptada, pero no se actualizo el servicio',
        );
      }

      const { error: historyError } = await supabase
        .from('service_status_history')
        .insert({
          service_id: assignment.service_id,
          status: 'assigned',
          changed_by: clientId,
          note: `Propuesta aceptada para el trabajador ${assignment.worker_id}`,
        });

      if (historyError) {
        throw new InternalServerErrorException(
          'La oferta fue aceptada, pero no se registro el historial',
        );
      }

      return {
        message: 'Oferta aceptada correctamente',
        service_status: 'assigned',
      };
    }

    const { error: rejectError } = await supabase
      .from('service_assignments')
      .update({
        status: 'rejected',
        responded_at: new Date().toISOString(),
      })
      .eq('id', assignmentId);

    if (rejectError) {
      throw new InternalServerErrorException('No se pudo rechazar la oferta');
    }

    return {
      message: 'Oferta rechazada correctamente',
    };
  }

  async findMyOffers(workerId: string) {
    const { data, error } = await this.supabaseService.client
      .from('service_assignments')
      .select(
        `
        id,
        service_id,
        worker_id,
        status,
        proposed_price,
        service_description,
        estimated_time_minutes,
        distance_km,
        available_date,
        available_from,
        available_to,
        created_at,
        services:service_id (
          id,
          description,
          address,
          status
        )
      `,
      )
      .eq('worker_id', workerId)
      .order('created_at', { ascending: false });

    if (error) {
      throw new InternalServerErrorException(
        'No se pudieron obtener tus ofertas',
      );
    }

    return data;
  }
}
