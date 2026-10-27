import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  InternalServerErrorException,
  NotFoundException,
} from '@nestjs/common';
import { SupabaseService } from '../supabase/supabase.service';
import { PushNotificationsService } from '../push-notifications/push-notifications.service';
import { getPlusConfig, isPlusClient } from '../memberships/pro';
import { CreateTicketDto, UpdateTicketDto } from './dto/create-ticket.dto';

const DAY_MS = 86400000;

/** ¿Sigue dentro de la garantía para reportar un servicio terminado? */
export function withinWarranty(completedAt: string | null, days: number, now = Date.now()) {
  if (!completedAt) return true;
  return now - new Date(completedAt).getTime() <= days * DAY_MS;
}

/**
 * "Reportar un problema" dentro del servicio y casos de soporte. Mientras el
 * cliente no confirme el trabajo, el pago sigue en custodia. Los clientes
 * SERCOM Plus (y los reportes de seguridad) tienen prioridad alta y Plus
 * amplía la garantía para reportar.
 */
@Injectable()
export class SupportService {
  constructor(
    private readonly supabaseService: SupabaseService,
    private readonly pushService: PushNotificationsService,
  ) {}

  private get db() {
    return this.supabaseService.sbRaw;
  }

  async create(userId: string, dto: CreateTicketDto) {
    let role: 'client' | 'worker' = 'client';
    const plus = await isPlusClient(this.db, userId);

    if (dto.service_id) {
      const { data: service } = await this.db
        .from('services')
        .select('id, client_id, assigned_worker_id, status, completed_at')
        .eq('id', dto.service_id)
        .maybeSingle();
      if (!service) throw new NotFoundException('Servicio no encontrado');
      if (service.client_id !== userId && service.assigned_worker_id !== userId) {
        throw new ForbiddenException('No participas en este servicio');
      }
      role = service.client_id === userId ? 'client' : 'worker';

      if (role === 'client' && service.status === 'completed') {
        const config = getPlusConfig();
        const { data: payment } = await this.db
          .from('payments')
          .select('warranty_days')
          .eq('service_id', service.id)
          .maybeSingle();
        const extended = Number(payment?.warranty_days ?? 0);
        const days = Math.max(plus ? config.warrantyDays : config.standardWarrantyDays, extended);
        if (!withinWarranty(service.completed_at, days)) {
          throw new BadRequestException(
            plus || extended > 0
              ? `Pasaron más de ${days} días desde el servicio. Escríbenos por el centro de ayuda.`
              : `La garantía para reportar es de ${days} días. Con SERCOM Plus son ${config.warrantyDays}.`,
          );
        }
      }
    } else {
      const { data: profile } = await this.db
        .from('profiles')
        .select('active_role')
        .eq('id', userId)
        .maybeSingle();
      role = profile?.active_role === 'worker' ? 'worker' : 'client';
    }

    const { data, error } = await this.db
      .from('support_tickets')
      .insert({
        service_id: dto.service_id ?? null,
        user_id: userId,
        user_role: role,
        category: dto.category,
        description: dto.description.trim(),
        priority: plus || dto.category === 'safety' ? 'high' : 'normal',
      })
      .select('id, number, category, status, priority, created_at')
      .single();
    if (error) throw new InternalServerErrorException(error.message);

    return {
      message: `Recibimos tu reporte. Tu número de caso es #${data.number}.`,
      ticket: data,
    };
  }

  async listMine(userId: string) {
    const { data, error } = await this.db
      .from('support_tickets')
      .select('id, number, service_id, category, description, status, priority, resolution, created_at, services:service_id(title)')
      .eq('user_id', userId)
      .order('created_at', { ascending: false });
    if (error) throw new InternalServerErrorException(error.message);
    return { tickets: data ?? [] };
  }

  // ─── Admin ────────────────────────────────────────────────────────────

  async listAll(status?: string) {
    let q = this.db
      .from('support_tickets')
      .select('*, services:service_id(title), user:user_id(full_name, email, phone)')
      .order('priority', { ascending: true }) // 'high' antes que 'normal'
      .order('created_at', { ascending: true });
    if (status) q = q.eq('status', status);
    const { data, error } = await q;
    if (error) throw new InternalServerErrorException(error.message);
    return { tickets: data ?? [] };
  }

  async update(ticketId: string, dto: UpdateTicketDto) {
    const { data, error } = await this.db
      .from('support_tickets')
      .update({
        status: dto.status,
        resolution: dto.resolution ?? null,
        updated_at: new Date().toISOString(),
      })
      .eq('id', ticketId)
      .select('id, number, user_id, status')
      .maybeSingle();
    if (error) throw new InternalServerErrorException(error.message);
    if (!data) throw new NotFoundException('Caso no encontrado');

    if (dto.status !== 'open') {
      await this.pushService.sendToUser(data.user_id, {
        title: dto.status === 'resolved' ? `Caso #${data.number} resuelto` : `Revisando tu caso #${data.number}`,
        body: dto.resolution ?? 'Entra al centro de ayuda para ver el detalle.',
        data: { type: 'support_ticket', ticket_id: String(data.id) },
      });
    }
    return { ticket: data };
  }
}
