/* eslint-disable @typescript-eslint/no-unsafe-call */
/* eslint-disable @typescript-eslint/no-unsafe-member-access */
/* eslint-disable @typescript-eslint/no-unsafe-assignment */
import {
  Injectable,
  UnauthorizedException,
  InternalServerErrorException,
  ConflictException,
  BadRequestException,
} from '@nestjs/common';
import { LoginDto } from './dto/login.dto';
import { SupabaseService } from '../supabase/supabase.service';
import { ProfilesService } from '../profiles/profiles.service';
import { RegisterDto } from './dto/register.dto';

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
    const roles = dto.roles ?? [];
    const activeRole = dto.activeRole?.trim();

    console.log('DTO REGISTER:', dto);

    if (!roles.length) {
      throw new BadRequestException('Debes enviar al menos un rol');
    }

    if (!activeRole) {
      throw new BadRequestException('Debes enviar activeRole');
    }

    if (!roles.includes(activeRole)) {
      throw new BadRequestException(
        'activeRole debe existir dentro de roles',
      );
    }

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
        roles,
        activeRole,
        cedula: dto.cedula,
        phone: dto.phone,
        address: dto.address,
        specialty: dto.specialty,
      });

      console.log('PROFILE CREATED:', profile);
    } catch (err) {
      console.error('Error después de crear usuario auth:', err);
      throw err;
    }

    return {
      message: data.session
        ? 'Registro exitoso'
        : 'Registro exitoso. Verifica tu correo para activar la cuenta.',
      user: {
        id: data.user.id,
        email,
        fullName: dto.fullName,
        roles,
        activeRole,
        status: 'pending_verification',
      },
    };
  }
}