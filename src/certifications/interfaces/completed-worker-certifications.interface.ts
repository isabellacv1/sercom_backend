export interface WorkerCompletedCertView {
  worker: {
    id: string;
    full_name: string;
  };

  certifications: Array<{
    enrollment_id: string;

    completed_at: string;

    certification: {
      id: string;
      name: string;
      description: string | null;
      category: string;
      difficulty:
        | 'beginner'
        | 'intermediate'
        | 'advanced';
    };
  }>;
  total_completed: number;
  has_certifications: boolean;
}

export type EnrollmentStatus = 'enrolled' | 'in_progress' | 'completed';

export interface Certification {
  id: string;
  name: string;
  description: string | null;
  category: string;
  difficulty: string | null;
  duration_hours: number | null;
  is_active: boolean;
  created_at: string;
  updated_at: string;
}

export interface CertificationModule {
  id: string;
  certification_id: string;
  title: string;
  description: string | null;
  order_index: number;
  is_active: boolean;
  created_at: string;
  updated_at: string;
}

export interface WorkerCertification {
  id: string;
  worker_id: string;
  certification_id: string;
  status: EnrollmentStatus;
  completed_modules: number;   
  total_modules: number;       
  completed_at: string | null;
  enrolled_at: string;
  updated_at: string;
}

export interface WorkerModuleProgress {
  id: string;
  worker_id: string;
  enrollment_id: string;
  module_id: string;
  completed_at: string;
}

export interface ModuleWithProgress extends CertificationModule {
  is_completed: boolean;
  completed_at: string | null;
}

export interface EnrollmentProgressView {
  enrollment: WorkerCertification;
  certification: Pick<Certification, 'id' | 'name' | 'category' | 'difficulty' | 'duration_hours'>;
  progress_percent: number;
  modules: ModuleWithProgress[];
}