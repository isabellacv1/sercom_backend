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

    const existingReview = await this.reviewsTable
      .select('id')
      .eq('service_id', dto.service_id)
      .or(`reviewer_id.is.null,reviewer_id.eq.${clientId}`)
      .maybeSingle();

    if (existingReview.error) {
      throw new InternalServerErrorException(existingReview.error.message);
    }

    if (existingReview.data) {
      throw new ConflictException('Este servicio ya fue calificado');
    }

    const insertResponse = await this.reviewsTable
      .insert({
        service_id: dto.service_id,
        client_id: clientId,
        worker_id: service.assigned_worker_id,
        reviewer_id: clientId,
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

  /*
   * La tabla `reviews` guarda ambas direcciones y las distingue con
   * `reviewer_id` (columna real en la BD, ausente en los tipos generados):
   *   - cliente → trabajador: reviewer_id = client_id (o NULL en filas viejas)
   *   - trabajador → cliente: reviewer_id = worker_id
   * El backend escribía en `worker_client_reviews`, tabla que no existe.
   */
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  private get reviewsTable(): any {
    return this.supabaseService.client.from('reviews');
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

    const reviewResponse = await this.reviewsTable
      .select(
        'id, service_id, client_id, worker_id, rating, comment, created_at',
      )
      .eq('service_id', serviceId)
      .or(`reviewer_id.is.null,reviewer_id.eq.${service.client_id}`)
      .maybeSingle();

    if (reviewResponse.error) {
      throw new InternalServerErrorException(reviewResponse.error.message);
    }

    const canReview =
      service.client_id === userId &&
      service.status === 'completed' &&
      !!service.assigned_worker_id &&
      !reviewResponse.data;

    // Verificar si el técnico ya calificó al cliente
    const workerReviewResponse = await this.reviewsTable
      .select('id')
      .eq('service_id', serviceId)
      .eq('reviewer_id', service.assigned_worker_id ?? '')
      .maybeSingle();

    const canWorkerReview =
      service.assigned_worker_id === userId &&
      service.status === 'completed' &&
      !!service.client_id &&
      !workerReviewResponse.data;

    return {
      review: reviewResponse.data,
      can_review: canReview,
      can_worker_review: canWorkerReview,
    };
  }

  async createWorkerReview(workerId: string, dto: CreateReviewDto) {
    const serviceResponse = await this.supabaseService.client
      .from('services')
      .select('id, status, client_id, assigned_worker_id')
      .eq('id', dto.service_id)
      .maybeSingle();

    if (serviceResponse.error) {
      throw new InternalServerErrorException(serviceResponse.error.message);
    }

    const service = serviceResponse.data;
    if (!service) throw new NotFoundException('Servicio no encontrado');

    if (service.assigned_worker_id !== workerId) {
      throw new ForbiddenException('Solo el técnico del servicio puede calificarlo');
    }

    if (service.status !== 'completed') {
      throw new BadRequestException('El servicio debe estar completado para calificar');
    }

    const existing = await this.reviewsTable
      .select('id')
      .eq('service_id', dto.service_id)
      .eq('reviewer_id', workerId)
      .maybeSingle();

    if (existing.data) {
      throw new ConflictException('Ya calificaste a este cliente');
    }

    const insertResponse = await this.reviewsTable
      .insert({
        service_id: dto.service_id,
        worker_id: workerId,
        client_id: service.client_id,
        reviewer_id: workerId,
        rating: dto.rating,
        comment: dto.comment?.trim() || null,
      })
      .select('id, service_id, worker_id, client_id, rating, comment, created_at')
      .single();

    if (insertResponse.error) {
      throw new InternalServerErrorException(insertResponse.error.message);
    }

    return {
      message: 'Calificación al cliente registrada exitosamente',
      review: insertResponse.data,
    };
  }

  /**
   * Un cliente puede ver la reputación de un trabajador aunque su perfil no
   * esté publicado si ese trabajador se postuló o fue asignado a uno de sus
   * servicios: necesita evaluarlo para decidir.
   */
  private async hasWorkedWithRequester(workerId: string, requesterId: string) {
    const services = await this.supabaseService.client
      .from('services')
      .select('id, assigned_worker_id')
      .eq('client_id', requesterId);

    if (services.error || !services.data?.length) return false;
    if (services.data.some((s) => s.assigned_worker_id === workerId)) return true;

    const proposals = await this.supabaseService.client
      .from('proposals')
      .select('id', { count: 'exact', head: true })
      .eq('technician_id', workerId)
      .in(
        'service_id',
        services.data.map((s) => s.id),
      );

    return (proposals.count ?? 0) > 0;
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

      if (
        !profileResponse.data?.is_published &&
        !(await this.hasWorkedWithRequester(workerId, requesterId))
      ) {
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
      // Solo reseñas SOBRE el trabajador (no las que él escribió a clientes).
      .or(`reviewer_id.is.null,reviewer_id.neq.${workerId}`)
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
    const statsResponse = await this.reviewsTable
      .select('rating')
      .eq('worker_id', workerId)
      .or(`reviewer_id.is.null,reviewer_id.neq.${workerId}`);

    if (statsResponse.error) {
      throw new InternalServerErrorException(statsResponse.error.message);
    }

    const ratings = statsResponse.data ?? [];
    const count = ratings.length;
    const avg =
      count === 0
        ? 0
        : ratings.reduce(
            (sum: number, row: { rating: number }) => sum + Number(row.rating),
            0,
          ) / count;

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
