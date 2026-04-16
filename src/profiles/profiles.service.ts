import { Injectable, InternalServerErrorException } from '@nestjs/common';
import { SupabaseService } from '../supabase/supabase.service';

@Injectable()
export class ProfilesService {
  constructor(private readonly supabaseService: SupabaseService) {}

  async findAll() {
    const { data, error } = await this.supabaseService.sb
      .from('profiles')
      .select('*')
      .limit(20);

    if (error) {
      throw new InternalServerErrorException(error.message);
    }

    return data;
  }
}