import { Injectable, InternalServerErrorException } from '@nestjs/common';
import { SupabaseService } from '../supabase/supabase.service';

@Injectable()
export class ServiceOptionsService {
  constructor(private readonly supabaseService: SupabaseService) {}

  async findByCategory(categoryId: string) {
    const { data, error } = await this.supabaseService.sb
      .from('service_options')
      .select('*')
      .eq('category_id', categoryId)
      .order('title', { ascending: true });

    if (error) {
      throw new InternalServerErrorException(error.message);
    }

    return data;
  }

  async findOne(id: string) {
    const { data, error } = await this.supabaseService.sb
      .from('service_options')
      .select('*')
      .eq('id', id)
      .maybeSingle();

    if (error) {
      throw new InternalServerErrorException(error.message);
    }

    return data;
  }
}