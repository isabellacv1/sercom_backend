import {
  BadRequestException,
  ConflictException,
  Injectable,
  InternalServerErrorException,
  NotFoundException,
} from '@nestjs/common';
import { SupabaseService } from '../supabase/supabase.service';
import { EnrollmentProgressView, ModuleWithProgress, WorkerCompletedCertView } from './interfaces/completed-worker-certifications.interface';
import { CompleteModuleDto } from './dto/completed-module.dto';

@Injectable()
export class CertificationsService {
  constructor(private readonly supabaseService: SupabaseService) {}

  private async findEnrollmentOrFail(workerId: string, certificationId: string) {
    const { data, error } = await this.supabaseService.client
      .from('worker_certifications')
      .select('id, status, completed_modules, total_modules, completed_at, enrolled_at, updated_at')
      .eq('worker_id', workerId)
      .eq('certification_id', certificationId)
      .maybeSingle();

    if (error) throw new InternalServerErrorException('Error al buscar la inscripción');
    if (!data)  throw new NotFoundException('No estás inscrito en esta certificación');

    return data;
  }

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
          description,
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

  async getMyEnrollments(workerId: string) {
    const { data: enrollments, error } = await this.supabaseService.client
      .from('worker_certifications')
      .select('id, status, completed_modules, total_modules, completed_at, enrolled_at, updated_at, certification_id')
      .eq('worker_id', workerId)
      .order('enrolled_at', { ascending: false });

    if (error) throw new InternalServerErrorException('Error al obtener inscripciones');

    const results = await Promise.all(
      (enrollments ?? []).map((e) =>
        this.getMyProgress(workerId, e.certification_id)
      )
    );

    return results;
  }

  async getMyProgress(workerId: string, certificationId: string): Promise<EnrollmentProgressView> {
    const enrollment = await this.findEnrollmentOrFail(workerId, certificationId);

    const { data: certification, error: certError } = await this.supabaseService.client
      .from('certifications')
      .select('id, name, category, difficulty, duration_hours')
      .eq('id', certificationId)
      .single();

    if (certError || !certification) {
      throw new InternalServerErrorException('Error al obtener la certificación');
    }

    const { data: modules, error: modulesError } = await this.supabaseService.client
      .from('certification_modules')
      .select('id, title, description, order_index, is_active, created_at, updated_at')
      .eq('certification_id', certificationId)
      .eq('is_active', true)
      .order('order_index', { ascending: true });

    if (modulesError) throw new InternalServerErrorException('Error al obtener los módulos');

    const { data: completedRows, error: progressError } = await this.supabaseService.client
      .from('worker_module_progress')
      .select('module_id, completed_at')
      .eq('enrollment_id', enrollment.id);

    if (progressError) throw new InternalServerErrorException('Error al obtener el progreso');

    const completedMap = new Map(
      (completedRows ?? []).map((row) => [row.module_id, row.completed_at]),
    );

    const modulesWithProgress: ModuleWithProgress[] = (modules ?? []).map((mod) => ({
      ...mod,
      certification_id: certificationId,
      is_completed: completedMap.has(mod.id),
      completed_at: completedMap.get(mod.id) ?? null,
    }));

    const total = modulesWithProgress.length;
    const completed = modulesWithProgress.filter((m) => m.is_completed).length;
    const progressPercent = total > 0 ? Math.round((completed / total) * 100) : 0;

    return {
      enrollment: enrollment as any,
      certification,
      progress_percent: progressPercent,
      modules: modulesWithProgress,
    };
  }

  async completeModule(
    workerId: string,
    certificationId: string,
    dto: CompleteModuleDto,
  ) {
    const enrollment = await this.findEnrollmentOrFail(workerId, certificationId);

    if (enrollment.status === 'completed') {
      throw new BadRequestException('Esta certificación ya está completada');
    }

    const { data: module, error: moduleError } = await this.supabaseService.client
      .from('certification_modules')
      .select('id, title, certification_id, is_active')
      .eq('id', dto.module_id)
      .eq('certification_id', certificationId)
      .eq('is_active', true)
      .maybeSingle();

    if (moduleError) throw new InternalServerErrorException('Error al verificar el módulo');
    if (!module)     throw new NotFoundException('Módulo no encontrado en esta certificación');

    const { data: existing, error: existingError } = await this.supabaseService.client
      .from('worker_module_progress')
      .select('id')
      .eq('enrollment_id', enrollment.id)
      .eq('module_id', dto.module_id)
      .maybeSingle();

    if (existingError) throw new InternalServerErrorException('Error al verificar el módulo');
    if (existing)      throw new ConflictException('Este módulo ya fue completado');

    const { error: insertError } = await this.supabaseService.client
      .from('worker_module_progress')
      .insert({
        worker_id:     workerId,
        enrollment_id: enrollment.id,
        module_id:     dto.module_id,
      });

    if (insertError) {
      throw new InternalServerErrorException('Error al registrar el módulo como completado');
    }

    return this.getMyProgress(workerId, certificationId);
  }


  async findAll(category?: string) {
  let query = this.supabaseService.client
    .from('certifications')
    .select(`
      id,
      name,
      description,
      category,
      difficulty,
      duration_hours
    `)
    .eq('is_active', true)
    .order('created_at', { ascending: false });

  if (category) {
    query = query.eq('category', category);
  }

  const { data, error } = await query;

  if (error) {
    throw new InternalServerErrorException(
      'Error al obtener certificaciones',
    );
  }

  return {
    certifications: data ?? [],
    total: data?.length ?? 0,
  };
}

async findOne(id: string) {
  const { data: certification, error } =
    await this.supabaseService.client
      .from('certifications')
      .select(`
        id,
        name,
        description,
        category,
        difficulty,
        duration_hours,
        certification_modules (
          id,
          title,
          description,
          order_index
        )
      `)
      .eq('id', id)
      .eq('is_active', true)
      .eq('certification_modules.is_active', true)
      .single();

  if (error) {
    throw new InternalServerErrorException(
      'Error al obtener certificación',
    );
  }

  if (!certification) {
    throw new NotFoundException(
      'Certificación no encontrada',
    );
  }

  return certification;
}

async enroll(workerId: string, certificationId: string) {
  // Verificar que la certificación exista y esté activa
  const { data: certification, error: certError } =
    await this.supabaseService.client
      .from('certifications')
      .select('id, is_active')
      .eq('id', certificationId)
      .maybeSingle();

  if (certError) {
    throw new InternalServerErrorException(
      'Error al verificar la certificación',
    );
  }

  if (!certification || !certification.is_active) {
    throw new NotFoundException(
      'La certificación no existe o no está disponible',
    );
  }

  // Verificar si ya está inscrito
  const { data: existingEnrollment, error: existingError } =
    await this.supabaseService.client
      .from('worker_certifications')
      .select('id')
      .eq('worker_id', workerId)
      .eq('certification_id', certificationId)
      .maybeSingle();

  if (existingError) {
    throw new InternalServerErrorException(
      'Error al verificar la inscripción',
    );
  }

  if (existingEnrollment) {
    throw new ConflictException(
      'Ya estás inscrito en esta certificación',
    );
  }

  // Contar módulos activos
  const { count, error: modulesError } =
    await this.supabaseService.client
      .from('certification_modules')
      .select('*', { count: 'exact', head: true })
      .eq('certification_id', certificationId)
      .eq('is_active', true);

  if (modulesError) {
    throw new InternalServerErrorException(
      'Error al contar módulos',
    );
  }

  const totalModules = count ?? 0;

  // Crear inscripción
  const { error: insertError } =
    await this.supabaseService.client
      .from('worker_certifications')
      .insert({
        worker_id: workerId,
        certification_id: certificationId,
        status: 'enrolled',
        completed_modules: 0,
        total_modules: totalModules,
      });

  if (insertError) {
    throw new InternalServerErrorException(
      'Error al realizar la inscripción',
    );
  }

  // Retornar progreso completo
  return this.getMyProgress(workerId, certificationId);
}
}