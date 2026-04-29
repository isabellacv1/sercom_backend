/* eslint-disable @typescript-eslint/no-unsafe-call */
/* eslint-disable @typescript-eslint/no-unsafe-member-access */
/* eslint-disable @typescript-eslint/no-unsafe-assignment */
import {
  Injectable,
  UnauthorizedException,
  InternalServerErrorException,
  ConflictException,
} from '@nestjs/common';
import { randomUUID } from 'crypto';
import { LoginDto } from './dto/login.dto';
import { SupabaseService } from '../supabase/supabase.service';
import { ProfilesService } from '../profiles/profiles.service';
import { RegisterDto } from './dto/register.dto';

type RegisterFiles = {
  cedulaDocument?: Express.Multer.File | null;
  workerPhoto?: Express.Multer.File | null;
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
    file: Express.Multer.File,
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
}
