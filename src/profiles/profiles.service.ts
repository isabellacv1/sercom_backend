import {
  BadRequestException,
  Injectable,
  InternalServerErrorException,
} from '@nestjs/common';
import { SupabaseService } from '../supabase/supabase.service';
import { Database } from '../types/supabase';
import { AppRoles } from 'src/auth/interfaces/app-roles';

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
      roles: [AppRoles.CLIENT],
      active_role: AppRoles.CLIENT,
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

  async updateRoles(userId: string, roles: AppRoles[]) {
    if (!roles || roles.length === 0) {
      throw new BadRequestException('Debes seleccionar al menos un rol');
    }

    const validRoles = Object.values(AppRoles);

    const isValid = roles.every(role => validRoles.includes(role));

    if (!isValid) {
      throw new BadRequestException('Roles inválidos');
    }

    const { data, error } = await this.supabaseService.sb
      .from('profiles')
      .update({
        roles: roles as string[],
        active_role: roles[0] as string, //default
      })
      .eq('id', userId)
      .select()
      .single();

    if (error) throw new InternalServerErrorException(error.message);

    return data;
  }

  async changeActiveRole(user: any, active_role: AppRoles) {
    const { data: profile, error } = await this.supabaseService.sb
      .from('profiles')
      .select('roles')
      .eq('id', user.sub)
      .single();

    if (error) throw new InternalServerErrorException(error.message);

    if (!profile.roles?.includes(active_role)) {
      throw new BadRequestException('No tienes ese rol');
    }

    const { data, error: updateError } = await this.supabaseService.sb
      .from('profiles')
      .update({ active_role })
      .eq('id', user.sub)
      .select()
      .single();

    if (updateError) throw new InternalServerErrorException(updateError.message);

    return data;
  }
}