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
import { CreateRecurrenceDto, RepeatServiceDto } from './dto/repeat-service.dto';

/** Tiempo que la solicitud repetida queda reservada para el mismo profesional. */
export const RESERVATION_HOURS = 24;
const PROCESS_EVERY_MS = 30 * 60 * 1000;
const DAY_MS = 86400000;

/** Siguiente ejecución estrictamente después de [now]. */
export function nextRunAfter(nextRunAt: Date, intervalDays: number, now = new Date()): Date {
  let next = nextRunAt.getTime();
  while (next <= now.getTime()) next += intervalDays * DAY_MS;
  return new Date(next);
}

/**
 * "Volver a pedir" y servicios recurrentes (limpieza cada 15 días...). La
 * solicitud nueva copia la anterior y queda reservada RESERVATION_HOURS para
 * el mismo profesional, que envía su propuesta como siempre.
 */
@Injectable()
export class RepeatService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(RepeatService.name);
  private timer?: NodeJS.Timeout;
  private processing = false;

  constructor(
    private readonly supabaseService: SupabaseService,
    private readonly pushService: PushNotificationsService,
  ) {}

  private get db() {
    return this.supabaseService.sbRaw;
  }

  onModuleInit() {
    if (process.env.NODE_ENV === 'test') return;
    this.timer = setInterval(() => void this.processDue(), PROCESS_EVERY_MS);
  }

  onModuleDestroy() {
    if (this.timer) clearInterval(this.timer);
  }

  async repeat(clientId: string, serviceId: string, dto: RepeatServiceDto) {
    const source = await this.requireFinishedSource(clientId, serviceId);
    const created = await this.cloneService(source, {
      scheduledAt: dto.scheduled_at ?? null,
    });
    return {
      message: 'Solicitud creada y reservada para el mismo profesional',
      service: created,
      reserved_hours: RESERVATION_HOURS,
    };
  }

  async createRecurrence(clientId: string, serviceId: string, dto: CreateRecurrenceDto) {
    const source = await this.requireFinishedSource(clientId, serviceId);
    const { data: existing } = await this.db
      .from('service_recurrences')
      .select('id')
      .eq('source_service_id', serviceId)
      .eq('active', true)
      .maybeSingle();
    if (existing) {
      throw new BadRequestException('Este servicio ya está programado como recurrente');
    }

    const nextRun = new Date(Date.now() + dto.interval_days * DAY_MS);
    const { data, error } = await this.db
      .from('service_recurrences')
      .insert({
        client_id: clientId,
        source_service_id: serviceId,
        worker_id: source.assigned_worker_id,
        interval_days: dto.interval_days,
        next_run_at: nextRun.toISOString(),
      })
      .select('id, interval_days, next_run_at, active')
      .single();
    if (error) throw new InternalServerErrorException(error.message);
    return { message: 'Servicio programado', recurrence: data };
  }

  async listRecurrences(clientId: string) {
    const { data, error } = await this.db
      .from('service_recurrences')
      .select(
        'id, interval_days, next_run_at, active, source:source_service_id(id, title), worker:worker_id(id, full_name)',
      )
      .eq('client_id', clientId)
      .eq('active', true)
      .order('next_run_at', { ascending: true });
    if (error) throw new InternalServerErrorException(error.message);
    return { recurrences: data ?? [] };
  }

  async cancelRecurrence(clientId: string, recurrenceId: string) {
    const { data, error } = await this.db
      .from('service_recurrences')
      .update({ active: false })
      .eq('id', recurrenceId)
      .eq('client_id', clientId)
      .select('id')
      .maybeSingle();
    if (error) throw new InternalServerErrorException(error.message);
    if (!data) throw new NotFoundException('Programación no encontrada');
    return { message: 'Programación cancelada' };
  }

  /** Crea las solicitudes de las recurrencias vencidas (idempotente). */
  async processDue(clientId?: string) {
    if (this.processing) return;
    this.processing = true;
    try {
      let q = this.db
        .from('service_recurrences')
        .select('*')
        .eq('active', true)
        .lte('next_run_at', new Date().toISOString())
        .limit(50);
      if (clientId) q = q.eq('client_id', clientId);
      const { data: due } = await q;

      for (const rec of due ?? []) {
        // Avanzar primero: si algo falla no se duplica en el siguiente ciclo.
        const next = nextRunAfter(new Date(rec.next_run_at), rec.interval_days);
        const { data: claimed } = await this.db
          .from('service_recurrences')
          .update({ next_run_at: next.toISOString() })
          .eq('id', rec.id)
          .eq('next_run_at', rec.next_run_at)
          .select('id')
          .maybeSingle();
        if (!claimed) continue;

        const { data: source } = await this.db
          .from('services')
          .select('*')
          .eq('id', rec.source_service_id)
          .maybeSingle();
        if (!source) continue;

        try {
          await this.cloneService(source, {
            scheduledAt: rec.next_run_at,
            recurrenceId: rec.id,
            workerId: rec.worker_id,
          });
          await this.pushService.sendToUser(rec.client_id, {
            title: 'Tu servicio recurrente está listo',
            body: `Creamos tu solicitud de «${source.title ?? 'servicio'}». El profesional enviará su propuesta.`,
            data: { type: 'recurrence_created' },
          });
        } catch (err) {
          this.logger.error(`Recurrencia ${rec.id}: ${(err as Error).message}`);
        }
      }
    } finally {
      this.processing = false;
    }
  }

  // ─── Helpers ───────────────────────────────────────────────────────────

  private async requireFinishedSource(clientId: string, serviceId: string) {
    const { data: source, error } = await this.db
      .from('services')
      .select('*')
      .eq('id', serviceId)
      .maybeSingle();
    if (error) throw new InternalServerErrorException(error.message);
    if (!source) throw new NotFoundException('Servicio no encontrado');
    if (source.client_id !== clientId) {
      throw new ForbiddenException('Solo puedes repetir tus propios servicios');
    }
    if (source.status !== 'completed') {
      throw new BadRequestException('Solo puedes repetir un servicio terminado');
    }
    return source;
  }

  private async cloneService(
    source: any,
    opts: { scheduledAt: string | null; recurrenceId?: string; workerId?: string | null },
  ) {
    const workerId = opts.workerId ?? source.assigned_worker_id ?? null;
    const reservedUntil = workerId
      ? new Date(Date.now() + RESERVATION_HOURS * 3600000).toISOString()
      : null;

    const { data: created, error } = await this.db
      .from('services')
      .insert({
        client_id: source.client_id,
        category_id: source.category_id,
        service_option_id: source.service_option_id,
        title: source.title,
        description: source.description,
        address: source.address,
        city: source.city,
        latitude: source.latitude,
        longitude: source.longitude,
        budget_min: source.budget_min,
        budget_max: source.budget_max,
        scheduled_at: opts.scheduledAt,
        status: 'requested',
        preferred_worker_id: workerId,
        reserved_until: reservedUntil,
        repeated_from: source.id,
        recurrence_id: opts.recurrenceId ?? null,
      })
      .select('id, title, status, scheduled_at, preferred_worker_id, reserved_until')
      .single();
    if (error) throw new InternalServerErrorException(error.message);

    await this.db.from('service_status_history').insert({
      service_id: created.id,
      status: 'requested',
      changed_by: source.client_id,
      note: opts.recurrenceId ? 'Servicio recurrente creado' : 'Servicio repetido por el cliente',
    });

    if (workerId) {
      const { data: client } = await this.db
        .from('profiles')
        .select('full_name')
        .eq('id', source.client_id)
        .maybeSingle();
      const name = client?.full_name?.split(' ')[0] ?? 'Un cliente';
      await this.pushService.sendToUser(workerId, {
        title: `${name} quiere repetir contigo`,
        body: `«${source.title ?? 'Servicio'}». Tienes ${RESERVATION_HOURS} horas para enviar tu propuesta antes de que otros la vean.`,
        data: { type: 'repeat_request', service_id: String(created.id) },
      });
    }
    return created;
  }
}
