import { Injectable, InternalServerErrorException } from '@nestjs/common';
import { SupabaseService } from '../supabase/supabase.service';

@Injectable()
export class ProfilesService {
  constructor(private readonly supabaseService: SupabaseService) {}

  async create(
    userId: string,
    dto: {
      fullName: string;
      email: string;
    },
  ) {
    const { data, error } = await this.supabaseService.client
      .from('profiles')
      .insert({
        id: userId,
        full_name: dto.fullName,
        email: dto.email,
        role: 'client',
        status: 'pending_documents',
      })
      .select()
      .single();

    if (error) {
      throw new InternalServerErrorException(
        'Error al crear el perfil del usuario',
      );
    }

    return data;
  }

  async updateStatus(userId: string, status: string) {
    const { data, error } = await this.supabaseService.client
      .from('profiles')
      .update({ status })
      .eq('id', userId)
      .select()
      .single();

    if (error) {
      throw new InternalServerErrorException(
        'Error al actualizar el estado del perfil',
      );
    }

    return data;
  }

  async findAll() {
    const { data, error } = await this.supabaseService.client
      .from('profiles')
      .select('*');

    if (error) {
      throw new InternalServerErrorException('Error al obtener los perfiles');
    }

    return data;
  }
}
