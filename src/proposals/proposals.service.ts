import { Injectable, InternalServerErrorException, ConflictException, NotFoundException, BadRequestException } from '@nestjs/common';
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
    const response = await this.supabaseService.sb
      .from('proposals')
      .insert({
        service_id: dto.service_id,
        technician_id: technicianId,
        price: dto.price,
        message: dto.message,
        estimated_duration: dto.estimated_duration ?? null,
      })
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
}
