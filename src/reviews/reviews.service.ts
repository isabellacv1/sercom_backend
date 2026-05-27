import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  InternalServerErrorException,
  NotFoundException,
} from '@nestjs/common';
import { SupabaseService } from '../supabase/supabase.service';
import { CreateReviewDto } from './dto/create-review.dto';

@Injectable()
export class ReviewsService {
  constructor(private readonly supabaseService: SupabaseService) {}

  async create(clientId: string, dto: CreateReviewDto) {
    const serviceResponse = await this.supabaseService.client
      .from('services')
      .select('id, status, client_id, assigned_worker_id')
      .eq('id', dto.service_id)
      .maybeSingle();

    if (serviceResponse.error) {
      throw new InternalServerErrorException(serviceResponse.error.message);
    }

    const service = serviceResponse.data;
    if (!service) {
      throw new NotFoundException('Servicio no encontrado');
    }

    if (service.client_id !== clientId) {
      throw new ForbiddenException(
        'Solo el cliente del servicio puede calificarlo',
      );
    }

    if (service.status !== 'completed') {
      throw new BadRequestException(
        'Solo puedes calificar un servicio marcado como completado',
      );
    }

    if (!service.assigned_worker_id) {
      throw new BadRequestException(
        'El servicio no tiene un trabajador asignado para calificar',
      );
    }

    const existingReview = await this.supabaseService.client
      .from('reviews')
      .select('id')
      .eq('service_id', dto.service_id)
      .maybeSingle();

    if (existingReview.error) {
      throw new InternalServerErrorException(existingReview.error.message);
    }

    if (existingReview.data) {
      throw new ConflictException('Este servicio ya fue calificado');
    }

    const insertResponse = await this.supabaseService.client
      .from('reviews')
      .insert({
        service_id: dto.service_id,
        client_id: clientId,
        worker_id: service.assigned_worker_id,
        rating: dto.rating,
        comment: dto.comment?.trim() || null,
      })
      .select(
        'id, service_id, client_id, worker_id, rating, comment, created_at',
      )
      .single();

    if (insertResponse.error) {
      throw new InternalServerErrorException(insertResponse.error.message);
    }

    await this.refreshWorkerRatingAggregates(service.assigned_worker_id);

    return {
      message: 'Calificación registrada exitosamente',
      review: insertResponse.data,
    };
  }

  async findByServiceForUser(userId: string, serviceId: string) {
    const serviceResponse = await this.supabaseService.client
      .from('services')
      .select('id, client_id, assigned_worker_id, status')
      .eq('id', serviceId)
      .maybeSingle();

    if (serviceResponse.error) {
      throw new InternalServerErrorException(serviceResponse.error.message);
    }

    const service = serviceResponse.data;
    if (!service) {
      throw new NotFoundException('Servicio no encontrado');
    }

    const isParticipant =
      service.client_id === userId ||
      service.assigned_worker_id === userId;

    if (!isParticipant) {
      throw new ForbiddenException('No tienes acceso a este servicio');
    }

    const reviewResponse = await this.supabaseService.client
      .from('reviews')
      .select(
        'id, service_id, client_id, worker_id, rating, comment, created_at',
      )
      .eq('service_id', serviceId)
      .maybeSingle();

    if (reviewResponse.error) {
      throw new InternalServerErrorException(reviewResponse.error.message);
    }

    const canReview =
      service.client_id === userId &&
      service.status === 'completed' &&
      !!service.assigned_worker_id &&
      !reviewResponse.data;

    return {
      review: reviewResponse.data,
      can_review: canReview,
    };
  }

  async findByWorker(workerId: string, requesterId?: string) {
    const isOwner = requesterId === workerId;

    if (requesterId && !isOwner) {
      const profileResponse = await this.supabaseService.client
        .from('profiles')
        .select('id, is_published')
        .eq('id', workerId)
        .maybeSingle();

      if (profileResponse.error) {
        throw new InternalServerErrorException(profileResponse.error.message);
      }

      if (!profileResponse.data?.is_published) {
        throw new ForbiddenException(
          'No tienes permiso para ver las calificaciones de este trabajador',
        );
      }
    }

    const reviewsResponse = await this.supabaseService.client
      .from('reviews')
      .select(
        `
        id,
        service_id,
        rating,
        comment,
        created_at,
        client:profiles!reviews_client_id_fkey (
          id,
          full_name,
          profile_image_url
        ),
        service:services!reviews_service_id_fkey (
          id,
          title
        )
      `,
      )
      .eq('worker_id', workerId)
      .order('created_at', { ascending: false });

    if (reviewsResponse.error) {
      throw new InternalServerErrorException(reviewsResponse.error.message);
    }

    const profileResponse = await this.supabaseService.client
      .from('profiles')
      .select('rating_avg, rating_count')
      .eq('id', workerId)
      .maybeSingle();

    if (profileResponse.error) {
      throw new InternalServerErrorException(profileResponse.error.message);
    }

    return {
      rating_avg: Number(profileResponse.data?.rating_avg ?? 0),
      rating_count: Number(profileResponse.data?.rating_count ?? 0),
      reviews: reviewsResponse.data ?? [],
    };
  }

  private async refreshWorkerRatingAggregates(workerId: string) {
    const statsResponse = await this.supabaseService.client
      .from('reviews')
      .select('rating')
      .eq('worker_id', workerId);

    if (statsResponse.error) {
      throw new InternalServerErrorException(statsResponse.error.message);
    }

    const ratings = statsResponse.data ?? [];
    const count = ratings.length;
    const avg =
      count === 0
        ? 0
        : ratings.reduce((sum, row) => sum + Number(row.rating), 0) / count;

    const updateResponse = await this.supabaseService.client
      .from('profiles')
      .update({
        rating_avg: Math.round(avg * 100) / 100,
        rating_count: count,
      })
      .eq('id', workerId);

    if (updateResponse.error) {
      throw new InternalServerErrorException(updateResponse.error.message);
    }
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
      .order('created_at', { ascending: false });

    if (error) {
      throw new InternalServerErrorException(
        `Error al obtener las calificaciones del perfil: ${error.message}`
      );
    }
    return reviews;
  }
}
