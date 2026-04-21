import {
  BadRequestException,
  Injectable,
  InternalServerErrorException,
} from '@nestjs/common';
import { SupabaseService } from '../supabase/supabase.service';
import { ProfilesService } from '../profiles/profiles.service';
import { Database } from '../types/supabase';

type UserDocumentInsert = Database['public']['Tables']['user_documents']['Insert'];

@Injectable()
export class UsersDocumentsService {
  constructor(
    private readonly supabaseService: SupabaseService,
    private readonly profilesService: ProfilesService,
  ) {}

  async uploadUserDocuments(
    userId: string,
    identityDocument: Express.Multer.File,
    selfiePhoto: Express.Multer.File,
  ) {
    this.validateFile(identityDocument, [
      'image/jpeg',
      'image/png',
      'application/pdf',
    ]);

    this.validateFile(selfiePhoto, ['image/jpeg', 'image/png']);

    const supabase = this.supabaseService.client;

    const identityFileName = this.sanitizeFileName(
      identityDocument.originalname,
    );
    const selfieFileName = this.sanitizeFileName(selfiePhoto.originalname);

    const now = Date.now();
    const identityPath = `users/${userId}/identity-${now}-${identityFileName}`;
    const selfiePath = `users/${userId}/selfie-${now}-${selfieFileName}`;

    const identityUpload = await supabase.storage
      .from('user-documents')
      .upload(identityPath, identityDocument.buffer, {
        contentType: identityDocument.mimetype,
        upsert: false,
      });

    if (identityUpload.error) {
      throw new InternalServerErrorException(
        `Error al subir la cédula: ${identityUpload.error.message}`,
      );
    }

    const selfieUpload = await supabase.storage
      .from('user-documents')
      .upload(selfiePath, selfiePhoto.buffer, {
        contentType: selfiePhoto.mimetype,
        upsert: false,
      });

    if (selfieUpload.error) {
      throw new InternalServerErrorException(
        `Error al subir la foto personal: ${selfieUpload.error.message}`,
      );
    }

    const identityUrl = supabase.storage
      .from('user-documents')
      .getPublicUrl(identityPath).data.publicUrl;

    const selfieUrl = supabase.storage
      .from('user-documents')
      .getPublicUrl(selfiePath).data.publicUrl;

    const documentsPayload: UserDocumentInsert[] = [
      {
        user_id: userId,
        document_type: 'id_card',
        file_url: identityUrl,
        file_name: identityFileName,
        verified: false,
      },
      {
        user_id: userId,
        document_type: 'selfie',
        file_url: selfieUrl,
        file_name: selfieFileName,
        verified: false,
      },
    ];

    const { error: documentsError } = await supabase
      .from('user_documents')
      .insert(documentsPayload);

    if (documentsError) {
      throw new InternalServerErrorException(
        `Error al guardar los documentos: ${documentsError.message}`,
      );
    }

    await this.profilesService.updateStatus(userId, 'pending_verification');

    return {
      message: 'Documentos cargados correctamente',
      status: 'pending_verification',
      documents: {
        identityDocument: {
          fileName: identityFileName,
          fileUrl: identityUrl,
          verified: false,
        },
        selfiePhoto: {
          fileName: selfieFileName,
          fileUrl: selfieUrl,
          verified: false,
        },
      },
    };
  }

  private validateFile(file: Express.Multer.File, allowedMimeTypes: string[]) {
    if (!allowedMimeTypes.includes(file.mimetype)) {
      throw new BadRequestException(
        `Tipo de archivo no permitido: ${file.originalname}`,
      );
    }

    const maxSizeInBytes = 5 * 1024 * 1024;

    if (file.size > maxSizeInBytes) {
      throw new BadRequestException(
        `El archivo ${file.originalname} supera el tamaño máximo permitido de 5 MB`,
      );
    }
  }

  private sanitizeFileName(fileName: string) {
    return fileName.replace(/\s+/g, '-').replace(/[^\w.-]/g, '');
  }
}