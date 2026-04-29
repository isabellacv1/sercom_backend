import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  InternalServerErrorException,
  NotFoundException,
  ConflictException,
} from '@nestjs/common';
import { SupabaseService } from '../supabase/supabase.service';
import { CreateProposalDto } from './dto/create-proposal.dto';
import { UpdateProposalDto } from './dto/update-proposal.dto';

@Injectable()
export class ProposalsService {
  constructor(private readonly supabaseService: SupabaseService) {}

  async create(technicianId: string, dto: CreateProposalDto) {
    const serviceResponse = await this.supabaseService.sb
      .from('services')
      .select('id, status')
      .eq('id', dto.service_id)
      .maybeSingle();

    if (serviceResponse.error) {
      throw new InternalServerErrorException(serviceResponse.error.message);
    }

    if (!serviceResponse.data) {
      throw new NotFoundException('El servicio no existe');
    }

    const { status } = serviceResponse.data;

    if (status !== 'requested') {
      throw new BadRequestException(
        'El servicio no está recibiendo postulaciones',
      );
    }

    const existingProposalResponse = await this.supabaseService.sb
      .from('proposals')
      .select('id')
      .eq('service_id', dto.service_id)
      .eq('technician_id', technicianId)
      .maybeSingle();

    if (existingProposalResponse.error) {
      throw new InternalServerErrorException(
        existingProposalResponse.error.message,
      );
    }

    if (existingProposalResponse.data) {
      throw new ConflictException(
        'Ya has enviado una propuesta para este servicio',
      );
    }

    const proposalToInsert: any = {
      service_id: dto.service_id,
      technician_id: technicianId,
      price: dto.price,
      message: dto.message,
      estimated_duration: dto.estimated_duration ?? null,
      available_date: dto.available_date,
      available_from: dto.available_from,
      available_to: dto.available_to,
    };

    const response = await this.supabaseService.sb
      .from('proposals')
      .insert([proposalToInsert])
      .select()
      .single();

    if (response.error) {
      throw new InternalServerErrorException(response.error.message);
    }

    if (!response.data) {
      throw new InternalServerErrorException('Error al crear la propuesta');
    }

    const insertedProposal = response.data as any;

    return {
      message: 'Propuesta creada exitosamente',
      proposal: {
        id: insertedProposal.id,
        serviceId: insertedProposal.service_id,
        technicianId: insertedProposal.technician_id,
        price: Number(insertedProposal.price),
        message: insertedProposal.message,
        estimatedDuration: insertedProposal.estimated_duration,
        status: insertedProposal.status,
        createdAt: new Date(insertedProposal.created_at),
        availableDate: insertedProposal.available_date,
        availableFrom: insertedProposal.available_from,
        availableTo: insertedProposal.available_to,
      },
    };
  }

  async findByServiceForClient(serviceId: string, clientId: string) {
    const serviceResponse = await this.supabaseService.sb
      .from('services')
      .select('id, client_id')
      .eq('id', serviceId)
      .maybeSingle();

    if (serviceResponse.error) {
      throw new InternalServerErrorException(serviceResponse.error.message);
    }

    if (!serviceResponse.data) {
      throw new NotFoundException('El servicio no existe');
    }

    if (serviceResponse.data.client_id !== clientId) {
      throw new ForbiddenException(
        'No tienes permiso para ver las propuestas de este servicio',
      );
    }

    const proposalsResponse = await this.supabaseService.sb
      .from('proposals')
      .select(
        `
        id,
        service_id,
        technician_id,
        price,
        message,
        estimated_duration,
        status,
        created_at,
        available_date,
        available_from,
        available_to,
        profiles:technician_id (
          id,
          full_name,
          rating_avg,
          rating_count,
          profile_image_url
        )
      `,
      )
      .eq('service_id', serviceId)
      .order('created_at', { ascending: true })
      .limit(5);

    if (proposalsResponse.error) {
      throw new InternalServerErrorException(proposalsResponse.error.message);
    }

    const proposals = proposalsResponse.data ?? [];

    return {
      message: 'Propuestas obtenidas exitosamente',
      total: proposals.length,
      proposals: proposals.map((proposal: any) => ({
        id: proposal.id,
        serviceId: proposal.service_id,
        technicianId: proposal.technician_id,
        price: Number(proposal.price),
        message: proposal.message,
        estimatedDuration: proposal.estimated_duration,
        status: proposal.status,
        createdAt: new Date(proposal.created_at),
        availableDate: proposal.available_date,
        availableFrom: proposal.available_from,
        availableTo: proposal.available_to,
        worker: {
          id: proposal.technician_id,
          name: proposal.profiles?.full_name ?? null,
          rating: Number(proposal.profiles?.rating_avg ?? 0),
          ratingCount: Number(proposal.profiles?.rating_count ?? 0),
          profileImageUrl: proposal.profiles?.profile_image_url ?? null,
        },
      })),
    };
  }

  async acceptProposal(proposalId: string, clientId: string) {
    const proposalResponse = await this.supabaseService.sb
      .from('proposals')
      .select(
        `
        id,
        service_id,
        technician_id,
        price,
        available_date,
        available_from,
        available_to,
        status
      `,
      )
      .eq('id', proposalId)
      .maybeSingle();

    if (proposalResponse.error) {
      throw new InternalServerErrorException(proposalResponse.error.message);
    }

    if (!proposalResponse.data) {
      throw new NotFoundException('La propuesta no existe');
    }

    const proposal = proposalResponse.data as any;

    if (proposal.status !== 'pending') {
      throw new ConflictException('Esta propuesta ya fue procesada');
    }

    const serviceResponse = await this.supabaseService.sb
      .from('services')
      .select('id, client_id, status, assigned_worker_id')
      .eq('id', proposal.service_id)
      .maybeSingle();

    if (serviceResponse.error) {
      throw new InternalServerErrorException(serviceResponse.error.message);
    }

    if (!serviceResponse.data) {
      throw new NotFoundException('El servicio no existe');
    }

    const service = serviceResponse.data as any;

    if (service.client_id !== clientId) {
      throw new ForbiddenException('No puedes aceptar esta propuesta');
    }

    if (service.status !== 'requested') {
      throw new ConflictException(
        'Este servicio ya no recibe propuestas o ya fue asignado',
      );
    }

    if (service.assigned_worker_id) {
      throw new ConflictException(
        'Este servicio ya tiene un trabajador asignado',
      );
    }

    const existingAssignment = await this.supabaseService.sb
      .from('service_assignments')
      .select('id')
      .eq('service_id', proposal.service_id)
      .maybeSingle();

    if (existingAssignment.error) {
      throw new InternalServerErrorException(existingAssignment.error.message);
    }

    if (existingAssignment.data) {
      throw new ConflictException(
        'Este servicio ya tiene un trabajador asignado',
      );
    }

    const assignmentResponse = await this.supabaseService.sb
      .from('service_assignments')
      .insert([
        {
          service_id: proposal.service_id,
          worker_id: proposal.technician_id,
          status: 'accepted',
          proposed_price: proposal.price,
          assigned_at: new Date().toISOString(),
          created_at: new Date().toISOString(),
          available_date: proposal.available_date,
          available_from: proposal.available_from,
          available_to: proposal.available_to,
        },
      ])
      .select()
      .single();

    if (assignmentResponse.error) {
      throw new InternalServerErrorException(assignmentResponse.error.message);
    }

    if (!assignmentResponse.data) {
      throw new InternalServerErrorException(
        'No se pudo crear la asignación del servicio',
      );
    }

    const chatRoomResponse = await this.supabaseService.sb
      .from('chat_rooms')
      .upsert(
        {
          service_id: proposal.service_id,
          client_id: clientId,
          worker_id: proposal.technician_id,
        },
        { onConflict: 'service_id' },
      )
      .select()
      .single();

    if (chatRoomResponse.error) {
      throw new InternalServerErrorException(chatRoomResponse.error.message);
    }

    const acceptProposalResponse = await this.supabaseService.sb
      .from('proposals')
      .update({ status: 'accepted' })
      .eq('id', proposalId);

    if (acceptProposalResponse.error) {
      throw new InternalServerErrorException(
        acceptProposalResponse.error.message,
      );
    }

    const rejectProposalsResponse = await this.supabaseService.sb
      .from('proposals')
      .update({ status: 'rejected' })
      .eq('service_id', proposal.service_id)
      .neq('id', proposalId);

    if (rejectProposalsResponse.error) {
      throw new InternalServerErrorException(
        rejectProposalsResponse.error.message,
      );
    }

    const updateServiceResponse = await this.supabaseService.sb
      .from('services')
      .update({
        status: 'assigned',
        assigned_worker_id: proposal.technician_id,
      })
      .eq('id', proposal.service_id)
      .select()
      .single();

    if (updateServiceResponse.error) {
      throw new InternalServerErrorException(updateServiceResponse.error.message);
    }

    if (!updateServiceResponse.data) {
      throw new InternalServerErrorException(
        'No se pudo asignar el trabajador al servicio',
      );
    }

    return {
      message: 'Propuesta aceptada y trabajador asignado',
      assignment: assignmentResponse.data,
      chatRoom: chatRoomResponse.data,
      service: updateServiceResponse.data,
    };
  }

  async update(technicianId: string, proposalId: string, dto: UpdateProposalDto) {
    if (
      dto.price === undefined &&
      dto.message === undefined &&
      dto.estimated_duration === undefined
    ) {
      throw new BadRequestException(
        'Debes enviar al menos un campo a actualizar: price, message o estimated_duration',
      );
    }

    const proposalResponse = await this.supabaseService.sb
      .from('proposals')
      .select('id, service_id, technician_id, status')
      .eq('id', proposalId)
      .maybeSingle();

    if (proposalResponse.error) {
      throw new InternalServerErrorException(proposalResponse.error.message);
    }

    if (!proposalResponse.data) {
      throw new NotFoundException('Propuesta no encontrada');
    }

    const proposal = proposalResponse.data as any;

    if (proposal.technician_id !== technicianId) {
      throw new ForbiddenException('No puedes editar esta propuesta');
    }

    if (proposal.status !== 'pending') {
      throw new BadRequestException(
        'No se puede editar una propuesta que ya fue procesada',
      );
    }

    const serviceResponse = await this.supabaseService.sb
      .from('services')
      .select('id, status, assigned_worker_id')
      .eq('id', proposal.service_id)
      .maybeSingle();

    if (serviceResponse.error) {
      throw new InternalServerErrorException(serviceResponse.error.message);
    }

    if (!serviceResponse.data) {
      throw new NotFoundException('Servicio asociado no encontrado');
    }

    const service = serviceResponse.data as any;

    if (service.status !== 'requested' || service.assigned_worker_id !== null) {
      throw new BadRequestException(
        'No se puede editar la propuesta: el trabajo ya no acepta ofertas',
      );
    }

    const updatePayload: {
      price?: number;
      message?: string | null;
      estimated_duration?: string | null;
    } = {};

    if (dto.price !== undefined) {
      updatePayload.price = dto.price;
    }

    if (dto.message !== undefined) {
      updatePayload.message = dto.message;
    }

    if (dto.estimated_duration !== undefined) {
      updatePayload.estimated_duration = dto.estimated_duration;
    }

    const updateResponse = await this.supabaseService.sb
      .from('proposals')
      .update(updatePayload)
      .eq('id', proposalId)
      .eq('technician_id', technicianId)
      .select()
      .single();

    if (updateResponse.error) {
      throw new InternalServerErrorException(updateResponse.error.message);
    }

    if (!updateResponse.data) {
      throw new InternalServerErrorException(
        'No se pudo actualizar la propuesta',
      );
    }

    const updatedProposal = updateResponse.data as any;

    return {
      message: 'Propuesta actualizada exitosamente',
      proposal: {
        id: updatedProposal.id,
        serviceId: updatedProposal.service_id,
        technicianId: updatedProposal.technician_id,
        price: Number(updatedProposal.price),
        message: updatedProposal.message,
        estimatedDuration: updatedProposal.estimated_duration,
        status: updatedProposal.status,
        createdAt: updatedProposal.created_at
          ? new Date(updatedProposal.created_at)
          : null,
        availableDate: updatedProposal.available_date,
        availableFrom: updatedProposal.available_from,
        availableTo: updatedProposal.available_to,
      },
    };
  }

  async findMineForWorker(
    technicianId: string,
    status?: 'pending' | 'accepted',
  ) {
    let query = this.supabaseService.sb
      .from('proposals')
      .select(
        `
        id,
        service_id,
        technician_id,
        price,
        message,
        status,
        created_at,
        available_date,
        available_from,
        available_to,
        services:service_id (
          id,
          title,
          description,
          address,
          status,
          budget_min,
          budget_max,
          created_at,
          service_categories:category_id (
            id,
            name
          )
        )
      `,
      )
      .eq('technician_id', technicianId)
      .order('created_at', { ascending: false });

    if (status) {
      query = query.eq('status', status);
    }

    const { data, error } = await query;

    if (error) {
      throw new InternalServerErrorException(error.message);
    }

    const proposals = (data ?? []) as any[];

    return proposals.map((p) => {
      const service = p.services ?? {};
      const category = service.service_categories ?? {};

      const statusLabelMap: Record<string, string> = {
        pending: 'Tu postulación está en revisión',
        accepted: 'Propuesta aceptada',
        rejected: 'Propuesta no seleccionada',
      };

      const createdAt = p.created_at ? new Date(p.created_at) : null;
      let createdAtRelative = '';

      if (createdAt) {
        const diffMs = Date.now() - createdAt.getTime();
        const diffMin = Math.floor(diffMs / 60000);

        if (diffMin < 60) {
          createdAtRelative = `Hace ${diffMin} min`;
        } else if (diffMin < 1440) {
          const hours = Math.floor(diffMin / 60);
          createdAtRelative = `Hace ${hours} hora${hours > 1 ? 's' : ''}`;
        } else {
          const days = Math.floor(diffMin / 1440);
          createdAtRelative = `Hace ${days} día${days > 1 ? 's' : ''}`;
        }
      }

      return {
        id: p.id,
        proposal_status: p.status,
        status_label: statusLabelMap[p.status] ?? p.status,
        price: Number(p.price),
        message: p.message,
        created_at_relative: createdAtRelative,
        available_date: p.available_date ?? null,
        available_from: p.available_from ?? null,
        available_to: p.available_to ?? null,

        service_id: p.service_id,
        service_title: service.title ?? null,
        description: service.description ?? null,
        address: service.address ?? null,
        status: service.status ?? null,
        price_min: service.budget_min ?? null,
        price_max: service.budget_max ?? null,

        category_name: category.name ?? null,
      };
    });
  }
}