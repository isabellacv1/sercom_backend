import { Injectable, InternalServerErrorException } from '@nestjs/common';
import { SupabaseService } from '../supabase/supabase.service';

@Injectable()
export class UsersService {
  constructor(private readonly supabaseService: SupabaseService) {}

  async findByEmail(email: string) {
    const normalizedEmail = email.toLowerCase().trim();

    const { data, error } = await this.supabaseService.client
      .from('users')
      .select('*')
      .eq('email', normalizedEmail)
      .maybeSingle();

    if (error) {
      throw new InternalServerErrorException(
        'Error al consultar el usuario por correo',
      );
    }

    return data;
  }

  async findById(id: string) {
    const { data, error } = await this.supabaseService.client
      .from('users')
      .select('*')
      .eq('id', id)
      .maybeSingle();

    if (error) {
      throw new InternalServerErrorException('Error al consultar el usuario');
    }

    return data;
  }

  async createAuthUser(payload: { email: string; passwordHash: string }) {
    const normalizedEmail = payload.email.toLowerCase().trim();

    const { data, error } = await this.supabaseService.client
      .from('users')
      .insert({
        email: normalizedEmail,
        password_hash: payload.passwordHash,
      })
      .select()
      .single();

    if (error) {
      throw new InternalServerErrorException('Error al crear el usuario');
    }

    return data;
  }
}
