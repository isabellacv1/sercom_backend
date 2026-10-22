import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  InternalServerErrorException,
  NotFoundException,
} from '@nestjs/common';
import { SupabaseService } from '../supabase/supabase.service';
import type { MulterFile } from '../common/types/multer.types';

/** Bucket privado: las fotos muestran el interior de la casa del cliente. */
export const EVIDENCE_BUCKET = 'service-evidence';
export const MAX_EVIDENCE_PER_SERVICE = 10;
const MAX_FILE_SIZE = 10 * 1024 * 1024;
const SIGNED_URL_TTL_SECONDS = 60 * 60;
const ALLOWED_MIME_TYPES = [
  'image/jpeg',
  'image/png',
  'image/webp',
  'image/heic',
  'image/heif',
];

/**
 * Evidencia del trabajo realizado. El técnico la adjunta mientras el
 * servicio está en ejecución y es obligatoria para pasarlo a "Finalizado".
 */
@Injectable()
export class ServiceEvidenceService {
  constructor(private readonly supabaseService: SupabaseService) {}

  private get db() {
    return this.supabaseService.sbRaw;
  }

  async upload(workerId: string, serviceId: string, files: MulterFile[]) {
    if (!files?.length) {
      throw new BadRequestException('Adjunta al menos una foto del trabajo');
    }

    const service = await this.requireService(serviceId);

    if (service.assigned_worker_id !== workerId) {
      throw new ForbiddenException(
        'Solo el trabajador asignado puede adjuntar evidencia',
      );
    }
    if (service.status !== 'in_progress') {
      throw new BadRequestException(
        'La evidencia se adjunta cuando el servicio está en ejecución',
      );
    }

    for (const file of files) {
      if (!ALLOWED_MIME_TYPES.includes(file.mimetype)) {
        throw new BadRequestException(
          'Solo se permiten fotos (JPG, PNG, WEBP o HEIC)',
        );
      }
      if (file.size > MAX_FILE_SIZE) {
        throw new BadRequestException('Cada foto debe pesar menos de 10 MB');
      }
    }

    const existing = await this.count(serviceId);
    if (existing + files.length > MAX_EVIDENCE_PER_SERVICE) {
      throw new BadRequestException(
        `Puedes adjuntar máximo ${MAX_EVIDENCE_PER_SERVICE} fotos por servicio`,
      );
    }

    const rows: Record<string, unknown>[] = [];
    for (const file of files) {
      const safeName = this.sanitizeFileName(file.originalname);
      const storagePath = `${serviceId}/${Date.now()}-${safeName}`;

      const { error } = await this.supabaseService.client.storage
        .from(EVIDENCE_BUCKET)
        .upload(storagePath, file.buffer, {
          contentType: file.mimetype,
          upsert: false,
        });

      if (error) {
        throw new InternalServerErrorException(
          `Error al subir la evidencia: ${error.message}`,
        );
      }

      rows.push({
        service_id: serviceId,
        worker_id: workerId,
        storage_path: storagePath,
        file_name: safeName,
      });
    }

    const { error: insertError } = await this.db
      .from('service_evidence')
      .insert(rows);

    if (insertError) {
      throw new InternalServerErrorException(insertError.message);
    }

    return {
      message: 'Evidencia adjuntada',
      evidence: await this.signedList(serviceId),
    };
  }

  async list(userId: string, serviceId: string) {
    const service = await this.requireService(serviceId);
    if (
      service.client_id !== userId &&
      service.assigned_worker_id !== userId
    ) {
      throw new ForbiddenException('No tienes acceso a este servicio');
    }
    return { evidence: await this.signedList(serviceId) };
  }

  async count(serviceId: string): Promise<number> {
    const { count, error } = await this.db
      .from('service_evidence')
      .select('id', { count: 'exact', head: true })
      .eq('service_id', serviceId);

    if (error) throw new InternalServerErrorException(error.message);
    return count ?? 0;
  }

  private async signedList(serviceId: string) {
    const { data, error } = await this.db
      .from('service_evidence')
      .select('id, storage_path, file_name, created_at')
      .eq('service_id', serviceId)
      .order('created_at', { ascending: true });

    if (error) throw new InternalServerErrorException(error.message);
    const rows = data ?? [];
    if (!rows.length) return [];

    const { data: signed, error: signError } =
      await this.supabaseService.client.storage
        .from(EVIDENCE_BUCKET)
        .createSignedUrls(
          rows.map((r) => r.storage_path),
          SIGNED_URL_TTL_SECONDS,
        );

    if (signError) throw new InternalServerErrorException(signError.message);

    return rows.map((r, i) => ({
      id: r.id,
      file_name: r.file_name,
      created_at: r.created_at,
      url: signed?.[i]?.signedUrl ?? null,
    }));
  }

  private async requireService(serviceId: string) {
    const { data, error } = await this.db
      .from('services')
      .select('id, client_id, assigned_worker_id, status')
      .eq('id', serviceId)
      .maybeSingle();

    if (error) throw new InternalServerErrorException(error.message);
    if (!data) throw new NotFoundException('Servicio no encontrado');
    return data;
  }

  private sanitizeFileName(name: string) {
    const clean = (name || 'foto')
      .normalize('NFD')
      .replace(/[̀-ͯ]/g, '')
      .replace(/[^a-zA-Z0-9._-]/g, '_')
      .slice(-80);
    return clean || 'foto';
  }
}
