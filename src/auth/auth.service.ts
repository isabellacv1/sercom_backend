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
        role: profile?.role ?? null,
        status: profile?.status ?? null,
      },
      access_token: data.session?.access_token,
      refresh_token: data.session?.refresh_token,
    };
  }

  async register(dto: RegisterDto) {
    const email = dto.email.toLowerCase().trim();

    const existingProfile = await this.profilesService.findByEmail(email);

    if (existingProfile) {
      throw new ConflictException('El correo electrónico ya está registrado');
    }

    const { data, error } = await this.supabaseService.client.auth.signUp({
      email,
      password: dto.password,
    });

    if (error || !data.user) {
      throw new InternalServerErrorException('Error al registrar el usuario');
    }

    await this.profilesService.create(data.user.id, {
      fullName: dto.fullName,
      email,
    });

    return {
      message: 'Registro exitoso',
      user: {
        id: data.user.id,
        email,
        fullName: dto.fullName,
        status: 'pending_documents',
      },
    };
  }
}
