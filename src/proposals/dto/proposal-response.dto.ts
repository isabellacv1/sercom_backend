class WorkerDto {
  id: string;
  name: string;
  rating: number;
  ratingCount: number;
  profileImageUrl: string;
}

export class ProposalResponseDto {
  id: string;
  serviceId: string;
  technicianId: string;
  price: number;
  message: string;
  estimatedDuration?: string;
  status: string;
  availableDate: string;
  availableFrom: string;
  availableTo: string;
  createdAt: Date;
  worker?: WorkerDto;
}
