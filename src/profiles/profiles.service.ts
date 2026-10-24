import { isProWorker } from '../memberships/pro';
import {
  BadRequestException,
  Injectable,
  InternalServerErrorException,
  NotFoundException,
} from '@nestjs/common';
import { SupabaseService } from '../supabase/supabase.service';
import { Database } from '../types/supabase';
import { AppRoles } from 'src/auth/interfaces/app-roles';
import { randomUUID } from 'crypto';
import type { MulterFile } from '../common/types/multer.types';

type ProfileInsert = Database['public']['Tables']['profiles']['Insert'];
type ProfileUpdate = Database['public']['Tables']['profiles']['Update'];
type ProfileStatus = Database['public']['Enums']['profile_status'];

type CreateProfileDto = {
  fullName: string;
  email: string;
  role?: 'client' | 'worker';
  cedula?: string | null;
  phone?: string | null;
  address?: string | null;
  specialty?: string | null;
  cedulaDocumentUrl?: string | null;
  workerPhotoUrl?: string | null;
};

@Injectable()
export class ProfilesService {
  constructor(private readonly supabaseService: SupabaseService) {}

  async updateProfilePhoto(userId: string, file: MulterFile) {
    const profile = await this.findByUserId(userId);
    if (!profile) {
      throw new NotFoundException('Perfil no encontrado');
    }

    try {
      const bucketName = 'profile-photos';
      const safeOriginalName = file.originalname.replace(
        /[^a-zA-Z0-9.-]/g,
        '_',
      );
      const filePath = `${userId}/foto-${randomUUID()}-${safeOriginalName}`;

      const { error: uploadError } = await this.supabaseService.client.storage
        .from(bucketName)
        .upload(filePath, file.buffer, {
          contentType: file.mimetype || 'application/octet-stream',
          upsert: false,
        });

      if (uploadError) {
        throw new InternalServerErrorException(
          `Error al subir a Supabase Storage: ${uploadError.message}`,
        );
      }

      const { data } = this.supabaseService.client.storage
        .from(bucketName)
        .getPublicUrl(filePath);

      const photoUrl = data.publicUrl;

      // Antes la URL solo se devolvía y se perdía al recargar: se persiste en
      // profile_image_url (lo que leen perfiles, propuestas y chat).
      const { data: saved, error: saveError } = await this.supabaseService.client
        .from('profiles')
        .update({ profile_image_url: photoUrl, worker_photo_url: photoUrl })
        .eq('id', userId)
        .select('*')
        .single();

      if (saveError) {
        throw new InternalServerErrorException(saveError.message);
      }

      const updatedProfile = {
        ...saved,
        workerPhotoUrl: photoUrl,
      };

      return {
        message: 'Foto de perfil actualizada con éxito',
        profile: updatedProfile,
      };
    } catch (error) {
      throw new BadRequestException(
        `Error al procesar o guardar la imagen: ${error.message}`,
      );
    }
  }

  /** Campos que cualquier usuario autenticado puede ver de otro perfil. */
  static readonly PUBLIC_FIELDS =
    'id, full_name, profile_image_url, bio, specialty, city, roles, rating_avg, rating_count, is_published, created_at';

  async findAll() {
    // Antes devolvía `*` (cédula, teléfono, correo, documentos) a cualquiera.
    const { data, error } = await this.supabaseService.client
      .from('profiles')
      .select(ProfilesService.PUBLIC_FIELDS)
      .order('created_at', { ascending: false });

    if (error) {
      throw new InternalServerErrorException('Error al obtener los perfiles');
    }

    return data;
  }

  /** Perfil público + estadísticas de servicios, sin datos sensibles. */
  async findPublic(profileId: string) {
    const { data: profile, error } = await this.supabaseService.client
      .from('profiles')
      .select(ProfilesService.PUBLIC_FIELDS)
      .eq('id', profileId)
      .maybeSingle();

    if (error) throw new InternalServerErrorException(error.message);
    if (!profile) throw new NotFoundException('Perfil no encontrado');

    const isWorker = (profile.roles ?? []).includes('worker');
    const column = isWorker ? 'assigned_worker_id' : 'client_id';

    const [total, completed] = await Promise.all([
      this.supabaseService.client
        .from('services')
        .select('id', { count: 'exact', head: true })
        .eq(column, profileId),
      this.supabaseService.client
        .from('services')
        .select('id', { count: 'exact', head: true })
        .eq(column, profileId)
        .eq('status', 'completed'),
    ]);

    return {
      ...profile,
      is_pro: isWorker
        ? await isProWorker(this.supabaseService.sbRaw, profileId)
        : false,
      stats: {
        total_services: total.count ?? 0,
        completed_services: completed.count ?? 0,
      },
    };
  }

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

  async create(userId: string, dto: CreateProfileDto) {
    const role = dto.role ?? 'client';

    const profileToInsert: ProfileInsert = {
      id: userId,
      full_name: dto.fullName,
      email: dto.email,
      roles: [role],
      active_role: role,

      // Como pediste que no haya validación, queda activo.
      // Si tu enum no tiene 'active', cambia esto por 'pending_verification'.
      status: 'verified' as ProfileStatus,

      phone: dto.phone ?? null,
    };

    if (role === 'worker') {
      profileToInsert.cedula = dto.cedula ?? null;
      profileToInsert.address = dto.address ?? null;
      profileToInsert.specialty = dto.specialty ?? null;
      profileToInsert.bio = dto.specialty ?? null;

      profileToInsert.cedula_document_url = dto.cedulaDocumentUrl ?? null;

      profileToInsert.worker_photo_url = dto.workerPhotoUrl ?? null;
      profileToInsert.profile_image_url = dto.workerPhotoUrl ?? null;
    }

    const { data, error } = await this.supabaseService.client
      .from('profiles')
      .insert(profileToInsert)
      .select('*')
      .single();

    if (error) {
      throw new InternalServerErrorException(error.message);
    }

    return data;
  }

  async updatePersonalInfo(
    userId: string,
    dto: {
      full_name?: string;
      fullName?: string;
      phone?: string;
      address?: string;
      city?: string;
      bio?: string;
    },
  ) {
    const profile = await this.findByUserId(userId);

    if (!profile) {
      throw new NotFoundException('Perfil no encontrado');
    }

    const fullName = dto.full_name ?? dto.fullName;

    const payload: ProfileUpdate = {};

    if (fullName !== undefined) {
      const name = String(fullName).trim();
      if (name.length < 3 || name.length > 120) {
        throw new BadRequestException('El nombre debe tener entre 3 y 120 caracteres');
      }
      payload.full_name = name;
    }

    if (dto.phone !== undefined) {
      const phone = String(dto.phone).trim();
      if (phone && !/^\+?[0-9\s-]{7,15}$/.test(phone)) {
        throw new BadRequestException('El teléfono no es válido');
      }
      payload.phone = phone;
    }

    if (dto.address !== undefined) {
      payload.address = String(dto.address).trim();
    }

    // Ciudad y descripción se editaban en la app pero se descartaban.
    if (dto.city !== undefined) {
      payload.city = String(dto.city).trim();
    }

    if (dto.bio !== undefined) {
      const bio = String(dto.bio).trim();
      if (bio.length > 500) {
        throw new BadRequestException('La descripción admite máximo 500 caracteres');
      }
      payload.bio = bio;
    }

    if (Object.keys(payload).length === 0) {
      throw new BadRequestException(
        'Debes enviar al menos un campo para actualizar',
      );
    }

    const { data, error } = await this.supabaseService.client
      .from('profiles')
      .update(payload)
      .eq('id', userId)
      .select('*')
      .single();

    if (error) {
      throw new InternalServerErrorException(error.message);
    }

    return data;
  }

  async updateStatus(userId: string, status: ProfileStatus) {
    const profile = await this.findByUserId(userId);

    if (!profile) {
      throw new NotFoundException('Perfil no encontrado');
    }

    const payload: ProfileUpdate = {
      status,
    };

    const { data, error } = await this.supabaseService.client
      .from('profiles')
      .update(payload)
      .eq('id', userId)
      .select('*')
      .single();

    if (error) {
      throw new InternalServerErrorException(error.message);
    }

    return data;
  }

  async updateRoles(userId: string, roles: AppRoles[]) {
    if (!roles || roles.length === 0) {
      throw new BadRequestException('Debes seleccionar al menos un rol');
    }

    const validRoles = Object.values(AppRoles);

    const isValid = roles.every((role) => validRoles.includes(role));

    if (!isValid) {
      throw new BadRequestException('Roles inválidos');
    }

    const payload: ProfileUpdate = {
      roles,
      active_role: roles[0],
    };

    const { data, error } = await this.supabaseService.client
      .from('profiles')
      .update(payload)
      .eq('id', userId)
      .select('*')
      .single();

    if (error) {
      throw new InternalServerErrorException(error.message);
    }

    return data;
  }

  async changeActiveRole(user: any, activeRole: AppRoles) {
    const { data: profile, error } = await this.supabaseService.client
      .from('profiles')
      .select('roles')
      .eq('id', user.sub)
      .single();

    if (error) {
      throw new InternalServerErrorException(error.message);
    }

    if (!profile.roles?.includes(activeRole)) {
      if (activeRole === AppRoles.WORKER) {
        throw new BadRequestException('USER_NOT_ACTIVATED_AS_WORKER');
      }

      throw new BadRequestException('No tienes ese rol');
    }

    const payload: ProfileUpdate = {
      active_role: activeRole,
    };

    const { data, error: updateError } = await this.supabaseService.client
      .from('profiles')
      .update(payload)
      .eq('id', user.sub)
      .select('*')
      .single();

    if (updateError) {
      throw new InternalServerErrorException(updateError.message);
    }

    return data;
  }
}
