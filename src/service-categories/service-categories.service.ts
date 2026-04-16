import { Injectable, InternalServerErrorException } from '@nestjs/common';
import { SupabaseService } from '../supabase/supabase.service';

@Injectable()
export class ServiceCategoriesService {
  constructor(private readonly supabaseService: SupabaseService) {}

  async findAll() {
    const response = await this.supabaseService.sb
      .from('service_categories')
      .select('*')
      .eq('is_active', true)
      .order('name', { ascending: true });

    const data = response.data;
    const error = response.error;

    if (error) {
      throw new InternalServerErrorException(error.message);
    }

    return data;
  }
}