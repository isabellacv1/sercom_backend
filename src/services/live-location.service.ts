import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  InternalServerErrorException,
  NotFoundException,
} from '@nestjs/common';
import { SupabaseService } from '../supabase/supabase.service';
import { UpdateLocationDto } from './dto/update-location.dto';

/** Velocidad media urbana para estimar la llegada (km/h). */
const AVG_SPEED_KMH = 25;
/** Las calles no son línea recta: factor sobre la distancia directa. */
const ROUTE_FACTOR = 1.35;
/** Una ubicación más vieja que esto se considera desactualizada. */
const STALE_AFTER_MS = 10 * 60 * 1000;

export function distanceKm(a: { lat: number; lng: number }, b: { lat: number; lng: number }) {
  const R = 6371;
  const toRad = (d: number) => (d * Math.PI) / 180;
  const dLat = toRad(b.lat - a.lat);
  const dLng = toRad(b.lng - a.lng);
  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(a.lat)) * Math.cos(toRad(b.lat)) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
}

export function etaMinutes(km: number) {
  return Math.max(1, Math.round(((km * ROUTE_FACTOR) / AVG_SPEED_KMH) * 60));
}

/**
 * Ubicación en vivo del profesional mientras va en camino (como el
 * domiciliario de Rappi). Solo la ve el cliente del servicio y se borra al
 * llegar (estado "en ejecución").
 */
@Injectable()
export class LiveLocationService {
  constructor(private readonly supabaseService: SupabaseService) {}

  private get db() {
    return this.supabaseService.sbRaw;
  }

  async update(workerId: string, serviceId: string, dto: UpdateLocationDto) {
    const service = await this.requireService(serviceId);
    if (service.assigned_worker_id !== workerId) {
      throw new ForbiddenException('Solo el profesional asignado comparte su ubicación');
    }
    if (service.status !== 'on_the_way') {
      throw new BadRequestException('La ubicación se comparte solo mientras vas en camino');
    }

    const { error } = await this.db.from('service_locations').upsert(
      {
        service_id: serviceId,
        worker_id: workerId,
        latitude: dto.latitude,
        longitude: dto.longitude,
        accuracy: dto.accuracy ?? null,
        heading: dto.heading ?? null,
        updated_at: new Date().toISOString(),
      },
      { onConflict: 'service_id' },
    );
    if (error) throw new InternalServerErrorException(error.message);
    return { ok: true };
  }

  async get(userId: string, serviceId: string) {
    const service = await this.requireService(serviceId);
    if (service.client_id !== userId && service.assigned_worker_id !== userId) {
      throw new ForbiddenException('No tienes acceso a este servicio');
    }

    const destination =
      service.latitude != null && service.longitude != null
        ? { latitude: Number(service.latitude), longitude: Number(service.longitude) }
        : null;

    if (service.status !== 'on_the_way') {
      return { sharing: false, status: service.status, destination, location: null };
    }

    const { data: loc } = await this.db
      .from('service_locations')
      .select('latitude, longitude, heading, updated_at')
      .eq('service_id', serviceId)
      .maybeSingle();

    const fresh = loc && Date.now() - new Date(loc.updated_at).getTime() < STALE_AFTER_MS;
    if (!fresh) {
      return { sharing: false, status: service.status, destination, location: null };
    }

    const km = destination
      ? distanceKm(
          { lat: loc.latitude, lng: loc.longitude },
          { lat: destination.latitude, lng: destination.longitude },
        )
      : null;

    return {
      sharing: true,
      status: service.status,
      destination,
      location: loc,
      distance_km: km != null ? Math.round(km * 10) / 10 : null,
      eta_minutes: km != null ? etaMinutes(km) : null,
    };
  }

  /** Al llegar (o cancelar) la ubicación deja de guardarse. */
  async clear(serviceId: string) {
    await this.db.from('service_locations').delete().eq('service_id', serviceId);
  }

  private async requireService(serviceId: string) {
    const { data, error } = await this.db
      .from('services')
      .select('id, client_id, assigned_worker_id, status, latitude, longitude')
      .eq('id', serviceId)
      .maybeSingle();
    if (error) throw new InternalServerErrorException(error.message);
    if (!data) throw new NotFoundException('Servicio no encontrado');
    return data;
  }
}
