import { Injectable, InternalServerErrorException } from '@nestjs/common';
import { SupabaseService } from '../supabase/supabase.service';

@Injectable()
export class UsersService {
  constructor(private readonly supabaseService: SupabaseService) {}

  async findByEmail(email: string) {
    const normalizedEmail = email.toLowerCase().trim();

    const { data, error } = await this.supabaseService.client
      .from('profiles')
      .select('id, email')
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
      .from('profiles')
      .select('*')
      .eq('id', id)
      .maybeSingle();

    if (error) {
      throw new InternalServerErrorException('Error al consultar el usuario');
    }

    return data;
  }

  async createAuthUser(payload: { email: string; password: string }) {
    const normalizedEmail = payload.email.toLowerCase().trim();

    const { data, error } =
      await this.supabaseService.client.auth.admin.createUser({
        email: normalizedEmail,
        password: payload.password,
        email_confirm: true,
      });

    if (error) {
      throw new InternalServerErrorException(error.message);
    }

    if (!data.user) {
      throw new InternalServerErrorException(
        'Supabase no devolvio el usuario creado',
      );
    }

    return {
      id: data.user.id,
      email: data.user.email ?? normalizedEmail,
    };
  }
}
