import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  InternalServerErrorException,
  Logger,
  NotFoundException,
  OnModuleDestroy,
  OnModuleInit,
} from '@nestjs/common';
import { SupabaseService } from '../supabase/supabase.service';
import { PushNotificationsService } from '../push-notifications/push-notifications.service';
import { UpdateLocationDto } from './dto/update-location.dto';

/** Velocidad media urbana para estimar la llegada (km/h). */
const AVG_SPEED_KMH = 25;
/** Las calles no son línea recta: factor sobre la distancia directa. */
const ROUTE_FACTOR = 1.35;
/**
 * El profesional envía su ubicación cada 10 s. Si pasa más de un minuto sin
 * recibir nada, probablemente se quedó sin datos o sin GPS.
 */
export const SIGNAL_LOST_AFTER_MS = 60 * 1000;
/** Si el profesional nunca compartió su ubicación, se asume esta llegada. */
export const DEFAULT_ARRIVAL_MINUTES = 60;
/** Margen antes de avisar que el profesional se está demorando. */
export const LATE_GRACE_MINUTES = 10;
const CHECK_LATE_EVERY_MS = 60 * 1000;

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

type ArrivalTimes = { on_the_way_at?: string | null; expected_arrival_at?: string | null };

/**
 * Hora a la que debería haber llegado el profesional: la estimada con su
 * primera ubicación o, si nunca la compartió, una hora después de salir.
 */
export function arrivalDeadline(service: ArrivalTimes): Date | null {
  if (service.expected_arrival_at) return new Date(service.expected_arrival_at);
  if (service.on_the_way_at) {
    return new Date(new Date(service.on_the_way_at).getTime() + DEFAULT_ARRIVAL_MINUTES * 60000);
  }
  return null;
}

export function isLate(service: ArrivalTimes, now = new Date()) {
  const deadline = arrivalDeadline(service);
  if (!deadline) return false;
  return now.getTime() > deadline.getTime() + LATE_GRACE_MINUTES * 60000;
}

type TrackedService = ArrivalTimes & {
  id: string;
  title?: string | null;
  client_id: string;
  assigned_worker_id: string | null;
  status: string;
  latitude: number | null;
  longitude: number | null;
};

/**
 * Ubicación en vivo del profesional mientras va en camino (como el
 * domiciliario de Rappi). Solo la ve el cliente del servicio y se borra al
 * llegar (estado "en ejecución"). Si el profesional pierde la señal se
 * muestra la última ubicación conocida, y si se demora se avisa a ambos.
 */
@Injectable()
export class LiveLocationService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(LiveLocationService.name);
  private timer?: NodeJS.Timeout;
  private checking = false;

  constructor(
    private readonly supabaseService: SupabaseService,
    private readonly pushService: PushNotificationsService,
  ) {}

  private get db() {
    return this.supabaseService.sbRaw;
  }

  onModuleInit() {
    if (process.env.NODE_ENV === 'test') return;
    this.timer = setInterval(() => void this.notifyLate(), CHECK_LATE_EVERY_MS);
  }

  onModuleDestroy() {
    if (this.timer) clearInterval(this.timer);
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

    // Con la primera ubicación se fija la hora estimada de llegada.
    if (!service.expected_arrival_at && service.latitude != null && service.longitude != null) {
      const km = distanceKm(
        { lat: dto.latitude, lng: dto.longitude },
        { lat: Number(service.latitude), lng: Number(service.longitude) },
      );
      const expected = new Date(Date.now() + etaMinutes(km) * 60000).toISOString();
      await this.db
        .from('services')
        .update({ expected_arrival_at: expected })
        .eq('id', serviceId)
        .is('expected_arrival_at', null);
    }
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
      return { sharing: false, signal_lost: false, late: false, status: service.status, destination, location: null };
    }

    const deadline = arrivalDeadline(service);
    const base = {
      status: service.status,
      destination,
      late: isLate(service),
      expected_arrival_at: deadline?.toISOString() ?? null,
    };

    const { data: loc } = await this.db
      .from('service_locations')
      .select('latitude, longitude, heading, updated_at')
      .eq('service_id', serviceId)
      .maybeSingle();

    if (!loc) {
      return { ...base, sharing: false, signal_lost: false, location: null };
    }

    const ageMs = Date.now() - new Date(loc.updated_at).getTime();
    const fresh = ageMs < SIGNAL_LOST_AFTER_MS;
    const km = destination
      ? distanceKm(
          { lat: loc.latitude, lng: loc.longitude },
          { lat: destination.latitude, lng: destination.longitude },
        )
      : null;

    return {
      ...base,
      sharing: fresh,
      // Hay una ubicación, pero dejó de actualizarse: se muestra la última.
      signal_lost: !fresh,
      location: loc,
      last_seen_seconds: Math.max(0, Math.round(ageMs / 1000)),
      distance_km: km != null ? Math.round(km * 10) / 10 : null,
      eta_minutes: km != null ? etaMinutes(km) : null,
    };
  }

  /** Al llegar (o cancelar) la ubicación deja de guardarse. */
  async clear(serviceId: string) {
    await this.db.from('service_locations').delete().eq('service_id', serviceId);
  }

  /** Avisa una sola vez al cliente y al profesional si este se está demorando. */
  async notifyLate(now = new Date()) {
    if (this.checking) return;
    this.checking = true;
    try {
      const { data, error } = await this.db
        .from('services')
        .select('id, title, client_id, assigned_worker_id, status, latitude, longitude, on_the_way_at, expected_arrival_at')
        .eq('status', 'on_the_way')
        .is('late_notified_at', null)
        .not('on_the_way_at', 'is', null);
      if (error) throw new Error(error.message);

      for (const service of (data ?? []) as TrackedService[]) {
        if (!isLate(service, now)) continue;
        const { data: claimed } = await this.db
          .from('services')
          .update({ late_notified_at: now.toISOString() })
          .eq('id', service.id)
          .is('late_notified_at', null)
          .select('id');
        if (!claimed?.length) continue; // Ya se avisó.

        const what = service.title ? ` (${service.title})` : '';
        await this.pushService.sendToUser(service.client_id, {
          title: 'Tu profesional se está demorando',
          body: `Ya pasó la hora estimada de llegada${what}. Escríbele por el chat para saber cómo va.`,
          data: { type: 'service_late', service_id: service.id },
        });
        if (service.assigned_worker_id) {
          await this.pushService.sendToUser(service.assigned_worker_id, {
            title: 'El cliente te está esperando',
            body: `Ya pasó la hora estimada de llegada${what}. Si vas tarde, avísale por el chat.`,
            data: { type: 'service_late', service_id: service.id },
          });
        }
      }
    } catch (e) {
      this.logger.warn(`No se pudieron revisar los retrasos: ${(e as Error).message}`);
    } finally {
      this.checking = false;
    }
  }

  private async requireService(serviceId: string): Promise<TrackedService> {
    const { data, error } = await this.db
      .from('services')
      .select('id, client_id, assigned_worker_id, status, latitude, longitude, on_the_way_at, expected_arrival_at')
      .eq('id', serviceId)
      .maybeSingle();
    if (error) throw new InternalServerErrorException(error.message);
    if (!data) throw new NotFoundException('Servicio no encontrado');
    return data as TrackedService;
  }
}
