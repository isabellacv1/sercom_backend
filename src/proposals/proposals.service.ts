import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  InternalServerErrorException,
  NotFoundException,
} from '@nestjs/common';
import { SupabaseService } from '../supabase/supabase.service';
import { CreateProposalDto } from './dto/create-proposal.dto';
import { UpdateProposalDto } from './dto/update-proposal.dto';

@Injectable()
export class ProposalsService {
  constructor(private readonly supabaseService: SupabaseService) {}

  async create(technicianId: string, dto: CreateProposalDto) {
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

  async update(technicianId: string, proposalId: string, dto: UpdateProposalDto) {
    if (
      dto.price === undefined &&
      dto.message === undefined &&
      dto.estimated_duration === undefined
    ) {
      throw new BadRequestException(
        'Debes enviar al menos un campo a actualizar (price, message o estimated_duration)',
      );
    }

    const proposalResponse = await this.supabaseService.sb
      .from('proposals')
      .select('id, service_id, technician_id, status')
      .eq('id', proposalId)
      .maybeSingle();

    const proposal = proposalResponse.data;
    const proposalError = proposalResponse.error;

    if (proposalError) {
      throw new InternalServerErrorException(proposalError.message);
    }

    if (!proposal) {
      throw new NotFoundException('Propuesta no encontrada');
    }

    if (proposal.technician_id !== technicianId) {
      throw new ForbiddenException('No puedes editar esta propuesta');
    }

    const serviceResponse = await this.supabaseService.sb
      .from('services')
      .select('id, status, assigned_worker_id')
      .eq('id', proposal.service_id)
      .maybeSingle();

    const service = serviceResponse.data;
    const serviceError = serviceResponse.error;

    if (serviceError) {
      throw new InternalServerErrorException(serviceError.message);
    }

    if (!service) {
      throw new NotFoundException('Servicio asociado no encontrado');
    }

    if (
      service.status !== 'requested' ||
      service.assigned_worker_id !== null
    ) {
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

    const data = updateResponse.data;
    const error = updateResponse.error;

    if (error) {
      throw new InternalServerErrorException(error.message);
    }

    return {
      message: 'Propuesta actualizada',
      proposal: data,
    };
  }
}
