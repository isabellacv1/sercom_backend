import {
  Injectable,
  InternalServerErrorException,
  NotFoundException,
} from '@nestjs/common';
import { SupabaseService } from '../supabase/supabase.service';
import { WorkerCompletedCertView } from './interfaces/completed-worker-certifications.interface';

@Injectable()
export class CertificationsService {
  constructor(private readonly supabaseService: SupabaseService) {}

  async getWorkerCompletedCertifications(workerId: string): Promise<WorkerCompletedCertView> {
   
    const { data: profile, error: profileError } = await this.supabaseService.client
      .from('profiles')
      .select('id, full_name, roles')
      .eq('id', workerId)
      .maybeSingle();

    if (profileError) throw new InternalServerErrorException('Error al buscar el perfil');
    if (!profile)     throw new NotFoundException('Trabajador no encontrado');
    if (!profile.roles?.includes('worker')) {
      throw new NotFoundException('El perfil indicado no corresponde a un trabajador');
    }

    const { data, error } = await this.supabaseService.client
      .from('worker_certifications')
      .select(`
        id,
        completed_at,
        certifications (
          id,
          name,
          category,
          difficulty
        )
      `)
      .eq('worker_id', workerId)
      .eq('status', 'completed')
      .eq('certifications.is_active', true)
      .order('completed_at', { ascending: false });

    if (error) throw new InternalServerErrorException('Error al obtener las certificaciones');

    const certifications = (data ?? []).map((row) => ({
      enrollment_id: row.id,
      completed_at:  row.completed_at as string,
      certification: row.certifications as any,
    }));

    return {
      worker: {
        id:        profile.id,
        full_name: profile.full_name,
      },
      certifications,
      total_completed:   certifications.length,
      has_certifications: certifications.length > 0,
    };
  }
}