import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  InternalServerErrorException,
} from '@nestjs/common';
import { SupabaseService } from '../supabase/supabase.service';
import { CreateClientReviewDto } from './dto/create-client-review.dto';

@Injectable()
export class ReviewsService {
  constructor(private readonly supabaseService: SupabaseService) {}

  async createClientReview(reviewerId: string, dto: CreateClientReviewDto) {
    // 1. Fetch the service to validate status and assigned worker
    const { data: service, error: serviceError } = await this.supabaseService.client
      .from('services')
      .select('status, assigned_worker_id, client_id')
      .eq('id', dto.service_id)
      .maybeSingle();

    if (serviceError) {
      throw new InternalServerErrorException('Error al consultar el servicio');
    }

    if (!service) {
      throw new BadRequestException('El servicio no existe');
    }

    // 2. Validate business rules
    if (service.status !== 'completed') {
      throw new BadRequestException('El servicio debe estar completado para poder calificar al cliente');
    }

    if (service.assigned_worker_id !== reviewerId) {
      throw new ForbiddenException('Solo el trabajador asignado puede calificar este servicio');
    }

    // 3. Insert review
    const { data: review, error: reviewError } = await this.supabaseService.client
      .from('reviews')
      .insert({
        service_id: dto.service_id,
        reviewer_id: reviewerId,
        worker_id: service.assigned_worker_id,
        client_id: service.client_id,
        rating: dto.rating,
        comment: dto.comment || null,
      } as any)
      .select('*')
      .single();

    if (reviewError) {
      // Handle potential unique constraint violation
      if (reviewError.code === '23505') {
        throw new BadRequestException('Ya has calificado a este cliente para este servicio');
      }
      throw new InternalServerErrorException(`Error al guardar la calificación: ${reviewError.message}`);
    }

    return review;
  }

  async getProfileReviews(profileId: string) {
    const { data: reviews, error } = await this.supabaseService.client
      .from('reviews')
      .select(`
        *,
        reviewer:profiles!reviewer_id(
          full_name,
          profile_image_url
        )
      `)
      .or(`client_id.eq.${profileId},worker_id.eq.${profileId}`)
      // .neq('reviewer_id' as any, profileId) // COMENTADO TEMPORALMENTE PARA PRUEBAS LOCALES (Mock data tiene el mismo ID)
      .order('created_at', { ascending: false });

    if (error) {
      throw new InternalServerErrorException(
        `Error al obtener las calificaciones del perfil: ${error.message}`,
      );
    }

    return reviews || [];
  }
}
