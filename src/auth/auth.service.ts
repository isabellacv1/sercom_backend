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

    // Cliente aislado: no contaminar el cliente compartido con la sesión.
    const { data, error } = await this.supabaseService
      .createSessionClient()
      .auth.signInWithPassword({
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

    // Se crea el usuario ya confirmado con la service key. El proyecto no
    // tiene SMTP propio: el correo de confirmación de Supabase solo llega a
    // miembros del equipo, lo que hacía fallar todo registro con
    // "Error sending confirmation email".
    const { data, error } =
      await this.supabaseService.client.auth.admin.createUser({
        email,
        password: dto.password,
        email_confirm: true,
        user_metadata: { full_name: dto.fullName, role },
      });

    if (error) {
      const msg = error.message.toLowerCase();
      if (msg.includes('already') || (error as { code?: string }).code === 'email_exists') {
        throw new ConflictException('El correo ya está registrado');
      }

      throw new InternalServerErrorException('No se pudo crear la cuenta');
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

    let profile: Awaited<ReturnType<ProfilesService['create']>>;
    try {
      profile = await this.profilesService.create(data.user.id, {
        fullName: dto.fullName,
        email,
        role,
        cedula: role === 'worker' ? dto.cedula : undefined,
        phone: dto.phone,
        address: role === 'worker' ? dto.address : undefined,
        specialty: role === 'worker' ? dto.specialty : undefined,
        cedulaDocumentUrl,
        workerPhotoUrl,
      });
    } catch (e) {
      // Sin perfil la cuenta queda inutilizable: se revierte el usuario de
      // auth para no dejar cuentas huérfanas que bloqueen el correo.
      await this.supabaseService.client.auth.admin.deleteUser(data.user.id);
      throw e;
    }

    return {
      message: 'Registro exitoso. Ya puedes iniciar sesión.',
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

  /**
   * La cédula va a un bucket PRIVADO y se guarda solo su ruta interna (nunca
   * una URL pública). La foto de perfil va al bucket público de fotos.
   */
  private async uploadWorkerFile(
    userId: string,
    file: MulterFile,
    type: 'cedula' | 'foto',
  ): Promise<string> {
    const bucketName = type === 'cedula' ? 'identity-documents' : 'profile-photos';

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

    if (type === 'cedula') return `${bucketName}/${filePath}`;

    const { data } = this.supabaseService.client.storage
      .from(bucketName)
      .getPublicUrl(filePath);

    return data.publicUrl;
  }

  /** Cambia el correo de la cuenta autenticada (nunca de un tercero). */
  async changeEmail(userId: string, oldEmail: string, newEmail: string) {
    const oldEmailNorm = (oldEmail ?? '').toLowerCase().trim();
    const newEmailNorm = (newEmail ?? '').toLowerCase().trim();

    if (!newEmailNorm || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(newEmailNorm)) {
      throw new BadRequestException('Correo inválido');
    }

    const { data: profile, error: profileError } =
      await this.supabaseService.client
        .from('profiles')
        .select('id, email')
        .eq('id', userId)
        .maybeSingle();

    if (profileError) {
      throw new InternalServerErrorException('No se pudo procesar la solicitud');
    }

    if (!profile?.id || (oldEmailNorm && profile.email?.toLowerCase() !== oldEmailNorm)) {
      throw new BadRequestException('El correo actual no coincide con tu cuenta');
    }

    if (oldEmailNorm === newEmailNorm) {
      return { message: 'Correo actualizado. Revisa tu nueva bandeja de entrada.' };
    }

    const { data, error } =
      await this.supabaseService.client.auth.admin.updateUserById(profile.id, {
        email: newEmailNorm,
      });

    if (error || !data.user) {
      throw new InternalServerErrorException('No se pudo actualizar el correo');
    }

    // Actualizar email en profiles también
    await this.supabaseService.client
      .from('profiles')
      .update({ email: newEmailNorm })
      .eq('id', profile.id);

    return { message: 'Correo actualizado. Revisa tu nueva bandeja de entrada.' };
  }
}
