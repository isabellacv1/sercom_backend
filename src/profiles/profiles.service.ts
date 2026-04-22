import {
  Injectable,
  InternalServerErrorException,
  BadRequestException,
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
      roles: string[];
      activeRole: string;
      cedula: string | undefined;
      phone: string | undefined;
      address: string | undefined;
      specialty: string | undefined
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
      roles: ['client'],
      active_role: 'client',
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

  async addRole(userId: string, newRole: string) {
    const profile = await this.findByUserId(userId);

    if (!profile) {
      throw new BadRequestException('Perfil no encontrado');
    }

    const currentRoles = Array.isArray(profile.roles) ? profile.roles : [];

    if (currentRoles.includes(newRole)) {
      return profile;
    }

    const updatedRoles = [...currentRoles, newRole];

    const { data, error } = await this.supabaseService.client
      .from('profiles')
      .update({ roles: updatedRoles })
      .eq('id', userId)
      .select()
      .single();

    if (error) {
      throw new InternalServerErrorException(
        'Error al agregar el rol al perfil',
      );
    }

    return data;
  }

  async setActiveRole(userId: string, activeRole: string) {
    const profile = await this.findByUserId(userId);

    if (!profile) {
      throw new BadRequestException('Perfil no encontrado');
    }

    const currentRoles = Array.isArray(profile.roles) ? profile.roles : [];

    if (!currentRoles.includes(activeRole)) {
      throw new BadRequestException(
        'El rol activo debe existir dentro del arreglo de roles',
      );
    }

    const { data, error } = await this.supabaseService.client
      .from('profiles')
      .update({ active_role: activeRole })
      .eq('id', userId)
      .select()
      .single();

    if (error) {
      throw new InternalServerErrorException(
        'Error al actualizar el rol activo',
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