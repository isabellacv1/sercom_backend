import { ServiceStatus } from '../services.service';

export class MissionResponseDto {
  id: string;
  title: string;
  description: string;
  address: string;
  status: ServiceStatus;
  budget_min: number;
  budget_max: number;
  price_min: number;
  price_max: number;
  category_name: string;
  proposals_count: number;
  offer_count: number;
  status_label: string;
  created_at: string;
  created_at_relative: string;
  worker_confirmation?: boolean;
  client_confirmation?: boolean;
  escrow_ui_message?: string;
}
