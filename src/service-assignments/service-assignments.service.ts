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

const MERCADO_PAGO_CHECKOUT_URL = 'https://link.mercadopago.com.co/sercomi';

type ServiceRow = {
  id: string;
  client_id: string;
  status: string;
};

type WorkerProfileRow = {
  id: string;
  role?: string | null;
  roles?: string[] | null;
  active_role?: string | null;
  is_active: boolean;
  status: string;
};

type AssignmentWithServiceRow = {
  id: string;
  service_id: string;
  worker_id: string;
  status: string;
  proposed_price: number | null;
  services:
    | {
        id: string;
        client_id: string;
        status: string;
      }
    | {
        id: string;
        client_id: string;
        status: string;
      }[]
    | null;
};

@Injectable()
export class ServiceAssignmentsService {
  constructor(private readonly supabaseService: SupabaseService) {}

  async create(workerId: string, dto: CreateServiceAssignmentDto) {
    const supabase = this.supabaseService.client;

    const { data: worker, error: workerError } = await supabase
      .from('profiles')
      .select('id, role, roles, active_role, is_active, status')
      .eq('id', workerId)
      .maybeSingle<WorkerProfileRow>();

    if (workerError) {
      throw new InternalServerErrorException('Error al validar el trabajador');
    }

    const roles = Array.isArray(worker?.roles) ? worker.roles : [];
    const isWorker =
      worker?.role === 'worker' ||
      worker?.active_role === 'worker' ||
      roles.includes('worker');

    if (!worker || !isWorker) {
      throw new ForbiddenException('Solo los trabajadores pueden ofertar');
    }

    if (!worker.is_active || worker.status !== 'verified') {
      throw new ForbiddenException(
        'Tu perfil no esta habilitado para enviar ofertas',
      );
    }

    const { data: service, error: serviceError } = await supabase
      .from('services')
      .select('id, client_id, status')
      .eq('id', dto.serviceId)
      .maybeSingle<ServiceRow>();

    if (serviceError) {
      throw new InternalServerErrorException(
        'Error al validar la solicitud de servicio',
      );
    }

    if (!service) {
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
      .maybeSingle<{ id: string; client_id: string }>();

    if (serviceError) {
      throw new InternalServerErrorException(
        'Error al validar el servicio solicitado',
      );
    }

    if (!service) {
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
          rating_avg,
          rating_count,
          profile_image_url,
          city,
          portfolio_url
        )
      `,
      )
      .eq('service_id', serviceId)
      .order('proposed_price', { ascending: true })
      .order('created_at', { ascending: true });

    if (error) {
      throw new InternalServerErrorException(
        'No se pudieron obtener las ofertas',
      );
    }

    const proposals =
      data?.map((item: Record<string, unknown>, index: number) => ({
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
        proposed_price,
        services:service_id (
          id,
          client_id,
          status
        )
        `,
      )
      .eq('id', assignmentId)
      .maybeSingle<AssignmentWithServiceRow>();

    if (assignmentError) {
      throw new InternalServerErrorException('Error al validar la oferta');
    }

    if (!assignment) {
      throw new NotFoundException('Oferta no encontrada');
    }

    const service = Array.isArray(assignment.services)
      ? assignment.services[0]
      : assignment.services;

    if (!service || service.client_id !== clientId) {
      throw new ForbiddenException('No puedes responder esta oferta');
    }

    if (service.status !== 'requested') {
      throw new BadRequestException(
        'Solo puedes responder ofertas de servicios en estado requested',
      );
    }

    if (assignment.status !== 'pending') {
      throw new BadRequestException('Esta oferta ya fue respondida');
    }

    if (dto.status === 'accepted') {
      const now = new Date().toISOString();

      const amountTotal = Number(assignment.proposed_price ?? 0);

      if (!Number.isFinite(amountTotal) || amountTotal <= 0) {
        throw new BadRequestException(
          'La oferta aceptada no tiene un valor válido para generar el pago',
        );
      }

      const commissionRate = 0.1;
      const commissionAmount = Math.round(amountTotal * commissionRate);
      const workerAmount = amountTotal - commissionAmount;

      const { data: existingPayment, error: existingPaymentError } =
        await supabase
          .from('payments')
          .select('id, status, checkout_url')
          .eq('service_id', assignment.service_id)
          .maybeSingle();

      if (existingPaymentError) {
        throw new InternalServerErrorException(
          'No se pudo validar si el servicio ya tiene pago',
        );
      }

      if (existingPayment) {
        throw new BadRequestException(
          'Este servicio ya tiene un pago asociado',
        );
      }

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

      const { data: updatedService, error: serviceUpdateError } = await supabase
        .from('services')
        .update({
          assigned_worker_id: assignment.worker_id,
          status: 'assigned',
        })
        .eq('id', assignment.service_id)
        .select()
        .single();

      if (serviceUpdateError) {
        throw new InternalServerErrorException(
          'La oferta fue aceptada, pero no se actualizo el servicio',
        );
      }

      if (!updatedService) {
        throw new InternalServerErrorException(
          'La oferta fue aceptada, pero no se obtuvo el servicio actualizado',
        );
      }

      const { data: payment, error: paymentError } = await supabase
        .from('payments')
        .insert({
          service_id: assignment.service_id,
          client_id: clientId,
          worker_id: assignment.worker_id,
          amount_total: amountTotal,
          commission_amount: commissionAmount,
          worker_amount: workerAmount,
          currency: 'COP',
          status: 'pending',
          provider: 'mercadopago',
          payment_method: 'mercadopago_link',
          provider_reference: null,
          checkout_url: MERCADO_PAGO_CHECKOUT_URL,
        } as any)
        .select()
        .single();

      if (paymentError) {
        throw new InternalServerErrorException(
          `La oferta fue aceptada, pero no se pudo crear el pago pendiente: ${paymentError.message}`,
        );
      }

      if (!payment) {
        throw new InternalServerErrorException(
          'La oferta fue aceptada, pero no se pudo crear el pago pendiente',
        );
      }

      const { error: historyError } = await supabase
        .from('service_status_history')
        .insert({
          service_id: assignment.service_id,
          status: 'assigned',
          changed_by: clientId,
          note: `Oferta aceptada. Trabajador asignado: ${assignment.worker_id}. Pago pendiente por Mercado Pago.`,
        });

      if (historyError) {
        throw new InternalServerErrorException(
          'La oferta fue aceptada, pero no se registro el historial',
        );
      }

      return {
        message:
          'Oferta aceptada correctamente. El cliente debe pagar con Mercado Pago para garantizar la reserva.',
        service_status: 'assigned',
        payment_status: payment.status,
        checkout_url: MERCADO_PAGO_CHECKOUT_URL,
        service: updatedService,
        payment,
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
        distance_km,
        available_date,
        available_from,
        available_to,
        created_at,
        services:service_id (
          id,
          title,
          description,
          address,
          city,
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
