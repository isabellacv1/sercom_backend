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

    const { count, error: countError } = await supabase
      .from('service_assignments')
      .select('*', { count: 'exact', head: true })
      .eq('service_id', dto.serviceId);

    if (countError) {
      throw new InternalServerErrorException('Error al validar las ofertas');
    }

    if ((count ?? 0) >= 5) {
      throw new BadRequestException(
        'Esta solicitud ya alcanzó el máximo de 5 ofertas',
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
        distance_km: dto.distanceKm ?? null,
        available_date: dto.availableDate,
        available_from: dto.availableFrom,
        available_to: dto.availableTo,
      })
      .select()
      .single();

    if (error) {
      throw new InternalServerErrorException('No se pudo crear la oferta');
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
        distance_km,
        available_date,
        available_from,
        available_to,
        created_at,
        profiles:worker_id (
          id,
          full_name,
          rating,
          portfolio_url
        )
      `,
      )
      .eq('service_id', serviceId)
      .order('created_at', { ascending: true });

    if (error) {
      throw new InternalServerErrorException(
        'No se pudieron obtener las ofertas',
      );
    }

    return data;
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

    if (dto.status === 'accepted') {
      const { error: acceptError } = await supabase
        .from('service_assignments')
        .update({
          status: 'accepted',
          responded_at: new Date().toISOString(),
          assigned_at: new Date().toISOString(),
        })
        .eq('id', assignmentId);

      if (acceptError) {
        throw new InternalServerErrorException('No se pudo aceptar la oferta');
      }

      const { error: rejectOthersError } = await supabase
        .from('service_assignments')
        .update({
          status: 'rejected',
          responded_at: new Date().toISOString(),
        })
        .eq('service_id', assignment.service_id)
        .neq('id', assignmentId)
        .eq('status', 'pending');

      if (rejectOthersError) {
        throw new InternalServerErrorException(
          'Se aceptó la oferta, pero falló el rechazo de las demás',
        );
      }

      const { error: serviceUpdateError } = await supabase
        .from('services')
        .update({
          status: 'assigned',
          worker_id: assignment.worker_id,
        })
        .eq('id', assignment.service_id);

      if (serviceUpdateError) {
        throw new InternalServerErrorException(
          'La oferta fue aceptada, pero no se actualizó el servicio',
        );
      }
    } else {
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
    }

    return {
      message: `Oferta ${dto.status === 'accepted' ? 'aceptada' : 'rechazada'} correctamente`,
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
