import {
  Injectable,
  InternalServerErrorException,
  ConflictException,
  NotFoundException,
  BadRequestException,
  ForbiddenException,
} from '@nestjs/common';
import { SupabaseService } from '../supabase/supabase.service';
import { CreateProposalDto } from './dto/create-proposal.dto';

@Injectable()
export class ProposalsService {
  constructor(private readonly supabaseService: SupabaseService) {}

  async create(technicianId: string, dto: CreateProposalDto) {
    // 1. Validate service exists and status
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
    if (status === 'completed' || status === 'cancelled') {
      throw new BadRequestException('No puedes enviar propuestas a un servicio cerrado');
    }

    // 2. Check for duplicate proposals by this technician for this service
    const existingProposalResponse = await this.supabaseService.sb
      .from('proposals')
      .select('id')
      .eq('service_id', dto.service_id)
      .eq('technician_id', technicianId)
      .maybeSingle();

    if (existingProposalResponse.error) {
      throw new InternalServerErrorException(existingProposalResponse.error.message);
    }

    if (existingProposalResponse.data) {
      throw new ConflictException('Ya has enviado una propuesta para este servicio');
    }

    // 3. Insert the proposal
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

    const data = response.data;
    const error = response.error;

    if (error) {
      throw new InternalServerErrorException(error.message);
    }

    return {
      message: 'Propuesta creada exitosamente',
      proposal: data,
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

    return {
      message: 'Propuestas obtenidas exitosamente',
      total: proposalsResponse.data.length,
      proposals: proposalsResponse.data.map((proposal: any) => ({
        id: proposal.id,
        serviceId: proposal.service_id,
        price: proposal.price,
        description: proposal.message,
        estimatedTime: proposal.estimated_duration,
        status: proposal.status,
        createdAt: proposal.created_at,
        availableDate: proposal.available_date,
        availableFrom: proposal.available_from,
        availableTo: proposal.available_to,
        worker: {
          id: proposal.technician_id,
          name: proposal.profiles?.full_name ?? null,
          rating: proposal.profiles?.rating_avg ?? null,
          ratingCount: proposal.profiles?.rating_count ?? 0,
          profileImageUrl: proposal.profiles?.profile_image_url ?? null,
        },
      })),
    };
  }
  async acceptProposal(proposalId: string, clientId: string) {
    // 1. Traer la propuesta
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
        available_to
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

    // 2. Validar servicio y ownership
    const serviceResponse = await this.supabaseService.sb
      .from('services')
      .select('id, client_id, status')
      .eq('id', proposal.service_id)
      .maybeSingle();

    if (serviceResponse.error) {
      throw new InternalServerErrorException(serviceResponse.error.message);
    }

    if (!serviceResponse.data) {
      throw new NotFoundException('El servicio no existe');
    }

    if (serviceResponse.data.client_id !== clientId) {
      throw new ForbiddenException('No puedes aceptar esta propuesta');
    }

    // 3. Verificar si ya existe asignación
    const existingAssignment = await this.supabaseService.sb
      .from('service_assignments')
      .select('id')
      .eq('service_id', proposal.service_id)
      .maybeSingle();

    if (existingAssignment.error) {
      throw new InternalServerErrorException(existingAssignment.error.message);
    }

    if (existingAssignment.data) {
      throw new ConflictException('Este servicio ya tiene un trabajador asignado');
    }

    // 4. Crear asignación
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

    // 5. Actualizar propuesta aceptada
    await this.supabaseService.sb
      .from('proposals')
      .update({ status: 'accepted' })
      .eq('id', proposalId);

    // 6. Rechazar las demás (opcional pero MUY recomendado)
    await this.supabaseService.sb
      .from('proposals')
      .update({ status: 'rejected' })
      .eq('service_id', proposal.service_id)
      .neq('id', proposalId);

    // 7. Actualizar servicio
    await this.supabaseService.sb
      .from('services')
      .update({ status: 'in_progress' })
      .eq('id', proposal.service_id);

    return {
      message: 'Propuesta aceptada y trabajador asignado',
      assignment: assignmentResponse.data,
    };
  }
}
