import {
  BadRequestException,
  Injectable,
  InternalServerErrorException,
  NotFoundException,
} from '@nestjs/common';
import { SupabaseService } from '../supabase/supabase.service';
import { CreateServiceDto } from './dto/create-service.dto';

@Injectable()
export class ServicesService {
  constructor(private readonly supabaseService: SupabaseService) {}

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

    const { data, error } = await this.supabaseService.sb
      .from('services')
      .insert({
        client_id: clientId,
        category_id: dto.category_id,
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
      .select()
      .single();

    if (error) {
      throw new InternalServerErrorException(error.message);
    }

    const { error: historyError } = await this.supabaseService.sb
      .from('service_status_history')
      .insert({
        service_id: data.id,
        status: 'requested',
        changed_by: clientId,
        note: 'Servicio creado por el cliente',
      });

    if (historyError) {
      throw new InternalServerErrorException(historyError.message);
    }

    return data;
  }

  async findMine(clientId: string) {
    const { data, error } = await this.supabaseService.sb
      .from('services')
      .select(
        `
        *,
        category:service_categories(id, name, description, icon)
      `,
      )
      .eq('client_id', clientId)
      .order('created_at', { ascending: false });

    if (error) {
      throw new InternalServerErrorException(error.message);
    }

    return data;
  }

  async findOneMine(clientId: string, serviceId: string) {
    const { data, error } = await this.supabaseService.sb
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

    if (error) {
      throw new InternalServerErrorException(error.message);
    }

    if (!data) {
      throw new NotFoundException('Servicio no encontrado');
    }

    return data;
  }
}
