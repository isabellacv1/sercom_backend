/* eslint-disable @typescript-eslint/no-unsafe-call */
/* eslint-disable @typescript-eslint/no-unsafe-member-access */
/* eslint-disable @typescript-eslint/no-unsafe-assignment */
import {
  Injectable,
  UnauthorizedException,
  InternalServerErrorException,
  ConflictException,
} from '@nestjs/common';
import { LoginDto } from './dto/login.dto';
import { SupabaseService } from '../supabase/supabase.service';
import { ProfilesService } from '../profiles/profiles.service';
import { RegisterDto } from './dto/register.dto';
type UserRole = 'client' | 'worker';
@Injectable()
export class AuthService {
  constructor(
    private readonly supabaseService: SupabaseService,
    private readonly profilesService: ProfilesService,
  ) {}

  async login(dto: LoginDto) {
    const email = dto.email.toLowerCase().trim();

    const { data, error } =
      await this.supabaseService.client.auth.signInWithPassword({
        email,
        password: dto.password,
      });

    if (error || !data.user) {
      throw new UnauthorizedException('Credenciales inválidas');
    }

    const profile = await this.profilesService.findByUserId(data.user.id);

    return {
      message: 'Login exitoso',
      user: {
        id: data.user.id,
        email: data.user.email,
        fullName: profile?.full_name ?? null,
        roles: profile?.roles ?? [],
        activeRole: profile?.active_role ?? null,
        status: profile?.status ?? null,
      },
      access_token: data.session?.access_token,
      refresh_token: data.session?.refresh_token,
    };
  }

  async register(dto: RegisterDto) {
    const email = dto.email.toLowerCase().trim();
<<<<<<< HEAD
    const role = dto.role ?? 'client';

    const { data, error } = await this.supabaseService.client.auth.signUp({
      email,
      password: dto.password,
    });

    if (error) {
      if (error.message.includes('User already registered')) {
        throw new ConflictException('El correo ya está registrado');
      }
      throw new InternalServerErrorException(error.message);
    }

    if (!data.user) {
      throw new InternalServerErrorException('No se pudo crear el usuario');
    }

    const profile = await this.profilesService.create(data.user.id, {
      fullName: dto.fullName,
      email,
      role,
      cedula: dto.cedula,
      phone: dto.phone,
      address: dto.address,
      specialty: dto.specialty,
    });

=======

    console.log('DTO REGISTER:', dto);

    const { data, error } = await this.supabaseService.client.auth.signUp({
      email,
      password: dto.password,
    });

    console.log('SUPABASE SIGNUP DATA:', data);
    console.log('SUPABASE SIGNUP ERROR:', error);

    if (error) {
      if (error.message.includes('User already registered')) {
        throw new ConflictException('El correo ya está registrado');
      }
      throw new InternalServerErrorException(error.message);
    }

    if (!data.user) {
      throw new InternalServerErrorException('No se pudo crear el usuario');
    }

    try {
      const profile = await this.profilesService.create(data.user.id, {
        fullName: dto.fullName,
        email,
      });

      console.log('PROFILE CREATED:', profile);
    } catch (err) {
      console.error('Error después de crear usuario auth:', err);
      throw err;
    }

>>>>>>> 81475b33948c9e84fc9a13a15050088fedf3e65e
    return {
      message: data.session
        ? 'Registro exitoso'
        : 'Registro exitoso. Verifica tu correo para activar la cuenta.',
      user: {
        id: data.user.id,
        email,
        fullName: dto.fullName,
<<<<<<< HEAD
        roles: profile.roles,
        activeRole: profile.active_role,
        status: profile.status,
=======
        roles: ['client'],
        activeRole: 'client',
        status: 'pending_verification',
>>>>>>> 81475b33948c9e84fc9a13a15050088fedf3e65e
      },
    };
  }
}
