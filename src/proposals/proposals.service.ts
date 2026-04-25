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
}
