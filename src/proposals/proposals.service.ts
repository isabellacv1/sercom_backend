import { Injectable, InternalServerErrorException } from '@nestjs/common';
import { SupabaseService } from '../supabase/supabase.service';
import { CreateProposalDto } from './dto/create-proposal.dto';

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
}
