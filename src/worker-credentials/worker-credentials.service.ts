import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  InternalServerErrorException,
  NotFoundException,
} from '@nestjs/common';
import { SupabaseService } from '../supabase/supabase.service';
import type { MulterFile } from '../common/types/multer.types';
import { CreateCredentialDto } from './dto/create-credential.dto';
import { ReviewCredentialDto } from './dto/review-credential.dto';

/** Privado: los certificados suelen incluir cédula y datos personales. */
export const CREDENTIALS_BUCKET = 'worker-credentials';
const MAX_CREDENTIALS = 15;
const MAX_FILE_SIZE = 10 * 1024 * 1024;
const SIGNED_URL_TTL_SECONDS = 60 * 60;
const ALLOWED_MIME_TYPES = [
  'application/pdf',
  'image/jpeg',
  'image/png',
  'image/webp',
  'image/heic',
  'image/heif',
];

const PUBLIC_COLUMNS = 'id, title, institution, issued_at, expires_at, status';

/**
 * Formación y certificados reales del profesional (reemplaza los cursos
 * internos, que no tenían validez). El cliente ve qué estudió, dónde y si
 * SerCom lo verificó; el archivo solo lo ven el profesional y el admin.
 */
@Injectable()
export class WorkerCredentialsService {
  constructor(private readonly supabaseService: SupabaseService) {}

  private get db() {
    return this.supabaseService.sbRaw;
  }

  async listMine(workerId: string) {
    const { data, error } = await this.db
      .from('worker_credentials')
      .select(`${PUBLIC_COLUMNS}, file_path, review_note, created_at`)
      .eq('worker_id', workerId)
      .order('created_at', { ascending: false });

    if (error) throw new InternalServerErrorException(error.message);
    return { credentials: await this.withSignedUrls(data ?? []) };
  }

  /** Vista pública para clientes: sin archivo ni notas internas. */
  async listForWorker(workerId: string) {
    const { data, error } = await this.db
      .from('worker_credentials')
      .select(PUBLIC_COLUMNS)
      .eq('worker_id', workerId)
      .neq('status', 'rejected')
      .order('status', { ascending: false }) // 'verified' antes que 'pending'
      .order('issued_at', { ascending: false, nullsFirst: false });

    if (error) throw new InternalServerErrorException(error.message);
    return { credentials: data ?? [] };
  }

  async create(workerId: string, dto: CreateCredentialDto, file?: MulterFile) {
    if (!file) {
      throw new BadRequestException('Adjunta el certificado (PDF o foto)');
    }
    if (!ALLOWED_MIME_TYPES.includes(file.mimetype)) {
      throw new BadRequestException('El certificado debe ser PDF o imagen');
    }
    if (file.size > MAX_FILE_SIZE) {
      throw new BadRequestException('El archivo debe pesar menos de 10 MB');
    }
    if (dto.issued_at && dto.expires_at && dto.expires_at < dto.issued_at) {
      throw new BadRequestException(
        'La fecha de vencimiento no puede ser anterior a la de expedición',
      );
    }

    const { count, error: countError } = await this.db
      .from('worker_credentials')
      .select('id', { count: 'exact', head: true })
      .eq('worker_id', workerId);
    if (countError) throw new InternalServerErrorException(countError.message);
    if ((count ?? 0) >= MAX_CREDENTIALS) {
      throw new BadRequestException(
        `Puedes registrar máximo ${MAX_CREDENTIALS} certificados`,
      );
    }

    const safeName = (file.originalname || 'certificado')
      .normalize('NFD')
      .replace(/[̀-ͯ]/g, '')
      .replace(/[^a-zA-Z0-9._-]/g, '_')
      .slice(-80);
    const filePath = `${workerId}/${Date.now()}-${safeName}`;

    const { error: uploadError } = await this.supabaseService.client.storage
      .from(CREDENTIALS_BUCKET)
      .upload(filePath, file.buffer, {
        contentType: file.mimetype,
        upsert: false,
      });
    if (uploadError) {
      throw new InternalServerErrorException(
        `Error al subir el certificado: ${uploadError.message}`,
      );
    }

    const { data, error } = await this.db
      .from('worker_credentials')
      .insert({
        worker_id: workerId,
        title: dto.title.trim(),
        institution: dto.institution.trim(),
        issued_at: dto.issued_at ?? null,
        expires_at: dto.expires_at ?? null,
        file_path: filePath,
        status: 'pending',
      })
      .select(`${PUBLIC_COLUMNS}, file_path, review_note, created_at`)
      .single();

    if (error) {
      await this.supabaseService.client.storage
        .from(CREDENTIALS_BUCKET)
        .remove([filePath]);
      throw new InternalServerErrorException(error.message);
    }

    const [credential] = await this.withSignedUrls([data]);
    return { message: 'Certificado enviado a revisión', credential };
  }

  async remove(workerId: string, credentialId: string) {
    const { data, error } = await this.db
      .from('worker_credentials')
      .select('id, worker_id, file_path')
      .eq('id', credentialId)
      .maybeSingle();

    if (error) throw new InternalServerErrorException(error.message);
    if (!data) throw new NotFoundException('Certificado no encontrado');
    if (data.worker_id !== workerId) {
      throw new ForbiddenException('No puedes eliminar este certificado');
    }

    const { error: deleteError } = await this.db
      .from('worker_credentials')
      .delete()
      .eq('id', credentialId);
    if (deleteError) throw new InternalServerErrorException(deleteError.message);

    await this.supabaseService.client.storage
      .from(CREDENTIALS_BUCKET)
      .remove([data.file_path]);

    return { message: 'Certificado eliminado' };
  }

  /** Admin: marcar como verificado o rechazado tras revisar el archivo. */
  async review(credentialId: string, dto: ReviewCredentialDto) {
    const { data, error } = await this.db
      .from('worker_credentials')
      .update({
        status: dto.status,
        review_note: dto.note ?? null,
        reviewed_at: new Date().toISOString(),
      })
      .eq('id', credentialId)
      .select(`${PUBLIC_COLUMNS}, worker_id`)
      .maybeSingle();

    if (error) throw new InternalServerErrorException(error.message);
    if (!data) throw new NotFoundException('Certificado no encontrado');
    return { credential: data };
  }

  private async withSignedUrls(rows: any[]) {
    if (!rows.length) return rows;
    const { data: signed } = await this.supabaseService.client.storage
      .from(CREDENTIALS_BUCKET)
      .createSignedUrls(
        rows.map((r) => r.file_path),
        SIGNED_URL_TTL_SECONDS,
      );
    return rows.map(({ file_path, ...r }, i) => ({
      ...r,
      file_url: signed?.[i]?.signedUrl ?? null,
    }));
  }
}
