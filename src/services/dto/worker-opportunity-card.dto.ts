export class WorkerOpportunityCardDto {
  service_id: string;
  title: string;
  type: string;
  location: {
    address: string;
    city: string | null;
    zone: string | null;
  };
  date: string | null;
  price: {
    min: number | null;
    max: number | null;
    currency: 'COP';
  };
  urgency_level: 'low' | 'medium' | 'high' | null;
  created_at: string;
}

export class WorkerOpportunitiesResponseDto {
  refreshed_at: string;
  total: number;
  opportunities: WorkerOpportunityCardDto[];
}
