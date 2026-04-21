import {
  Injectable,
  InternalServerErrorException,
} from '@nestjs/common';
import { SupabaseService } from '../supabase/supabase.service';
import { Database } from '../types/supabase';

type ProfileInsert = Database['public']['Tables']['profiles']['Insert'];
type ProfileStatus = Database['public']['Enums']['profile_status'];

@Injectable()
export class ProfilesService {
  constructor(private readonly supabaseService: SupabaseService) {}

  async findByEmail(email: string) {
    const { data, error } = await this.supabaseService.client
      .from('profiles')
      .select('*')
      .eq('email', email)
      .maybeSingle();

    if (error) {
      throw new InternalServerErrorException(
        'Error al consultar perfil por correo',
      );
    }

    return data;
  }

  async findByUserId(userId: string) {
    const { data, error } = await this.supabaseService.client
      .from('profiles')
      .select('*')
      .eq('id', userId)
      .maybeSingle();

    if (error) {
      throw new InternalServerErrorException(
        'Error al obtener el perfil del usuario',
      );
    }

    return data;
  }

  async create(
    userId: string,
    dto: {
      fullName: string;
      email: string;
    },
  ) {
    const existingProfile = await this.findByUserId(userId);

    if (existingProfile) {
      console.log('El perfil ya existe, se retorna el existente');
      return existingProfile;
    }

    const payload: ProfileInsert = {
      id: userId,
      full_name: dto.fullName,
      email: dto.email,
      role: 'client',
      status: 'pending_verification',
    };

    const { data, error } = await this.supabaseService.client
      .from('profiles')
      .insert(payload)
      .select()
      .single();

    if (error) {
      throw new InternalServerErrorException(error.message);
    }

    return data;
  }

  async updateStatus(userId: string, status: ProfileStatus) {
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