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