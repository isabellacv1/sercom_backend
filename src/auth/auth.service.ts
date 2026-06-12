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
import { randomUUID } from 'crypto';
import { LoginDto } from './dto/login.dto';
import { SupabaseService } from '../supabase/supabase.service';
import { ProfilesService } from '../profiles/profiles.service';
import { RegisterDto } from './dto/register.dto';
import type { MulterFile } from '../common/types/multer.types';

type RegisterFiles = {
  cedulaDocument?: MulterFile | null;
  workerPhoto?: MulterFile | null;
};

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
        phone: profile?.phone ?? null,
        address: profile?.address ?? null,
        city: profile?.city ?? null,
        bio: profile?.bio ?? null,
      },
      access_token: data.session?.access_token,
      refresh_token: data.session?.refresh_token,
    };
  }

  async socialLogin(supabaseToken: string) {
    if (!supabaseToken) {
      throw new UnauthorizedException('Token requerido');
    }

    const { data, error } =
      await this.supabaseService.client.auth.getUser(supabaseToken);

    if (error || !data.user) {
      throw new UnauthorizedException('Token inválido');
    }

    const user = data.user;
    let profile = await this.profilesService.findByUserId(user.id);

    if (!profile) {
      const email = user.email ?? '';
      const name =
        (user.user_metadata?.full_name as string | undefined) ??
        (user.user_metadata?.name as string | undefined) ??
        email.split('@')[0];
      await this.profilesService.create(user.id, {
        email,
        fullName: name,
        role: 'client',
      });
      profile = await this.profilesService.findByUserId(user.id);
    }

    return {
      message: 'Login exitoso',
      user: {
        id: user.id,
        email: user.email,
        fullName: profile?.full_name ?? null,
        roles: profile?.roles ?? [],
        activeRole: profile?.active_role ?? 'client',
        status: profile?.status ?? null,
      },
      access_token: supabaseToken,
    };
  }

  async register(dto: RegisterDto, files?: RegisterFiles) {
    const email = dto.email.toLowerCase().trim();
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

    let cedulaDocumentUrl: string | null = null;
    let workerPhotoUrl: string | null = null;

    if (role === 'worker') {
      if (files?.cedulaDocument) {
        cedulaDocumentUrl = await this.uploadWorkerFile(
          data.user.id,
          files.cedulaDocument,
          'cedula',
        );
      }

      if (files?.workerPhoto) {
        workerPhotoUrl = await this.uploadWorkerFile(
          data.user.id,
          files.workerPhoto,
          'foto',
        );
      }
    }

    const profile = await this.profilesService.create(data.user.id, {
      fullName: dto.fullName,
      email,
      role,
      cedula: role === 'worker' ? dto.cedula : undefined,
      phone: dto.phone,
      address: role === 'worker' ? dto.address : undefined,
      specialty: role === 'worker' ? dto.specialty : undefined,

      // Estas dos propiedades deben existir en tu ProfilesService.
      cedulaDocumentUrl,
      workerPhotoUrl,
    });

    return {
      message: data.session
        ? 'Registro exitoso'
        : 'Registro exitoso. Verifica tu correo para activar la cuenta.',
      user: {
        id: data.user.id,
        email,
        fullName: dto.fullName,
        roles: profile.roles,
        activeRole: profile.active_role,
        status: profile.status,
        phone: profile.phone ?? null,
        address: profile.address ?? null,
        city: profile.city ?? null,
        bio: profile.bio ?? null,
        cedulaDocumentUrl,
        workerPhotoUrl,
      },
    };
  }

  private async uploadWorkerFile(
    userId: string,
    file: MulterFile,
    type: 'cedula' | 'foto',
  ): Promise<string> {
    const bucketName = 'worker-documents';

    const safeOriginalName = file.originalname.replace(/[^a-zA-Z0-9.-]/g, '_');

    const filePath = `${userId}/${type}-${randomUUID()}-${safeOriginalName}`;

    const { error } = await this.supabaseService.client.storage
      .from(bucketName)
      .upload(filePath, file.buffer, {
        contentType: file.mimetype || 'application/octet-stream',
        upsert: false,
      });

    if (error) {
      throw new InternalServerErrorException(
        `No se pudo subir el archivo ${type}: ${error.message}`,
      );
    }

    const { data } = this.supabaseService.client.storage
      .from(bucketName)
      .getPublicUrl(filePath);

    return data.publicUrl;
  }

  async changeEmail(oldEmail: string, newEmail: string) {
    const oldEmailNorm = oldEmail.toLowerCase().trim();
    const newEmailNorm = newEmail.toLowerCase().trim();

    if (!newEmailNorm || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(newEmailNorm)) {
      throw new BadRequestException('Correo inválido');
    }
    if (oldEmailNorm === newEmailNorm) {
      throw new BadRequestException('El nuevo correo debe ser diferente');
    }

    // Buscar el ID del usuario por email en la tabla profiles
    const { data: profile, error: profileError } =
      await this.supabaseService.client
        .from('profiles')
        .select('id')
        .ilike('email', oldEmailNorm)
        .maybeSingle();

    if (profileError) {
      throw new InternalServerErrorException('No se pudo procesar la solicitud');
    }

    if (!profile?.id) {
      throw new BadRequestException('No se encontró una cuenta con ese correo');
    }

    const { data, error } =
      await this.supabaseService.client.auth.admin.updateUserById(profile.id, {
        email: newEmailNorm,
      });

    if (error || !data.user) {
      throw new InternalServerErrorException('No se pudo actualizar el correo');
    }

    return { message: 'Correo actualizado. Revisa tu nueva bandeja de entrada.' };
  }
}
