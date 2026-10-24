import { IsIn, IsNotEmpty, IsOptional, IsString, IsUUID, MaxLength, MinLength } from 'class-validator';

export const TICKET_CATEGORIES = ['no_show', 'quality', 'damage', 'payment', 'safety', 'other'] as const;
export type TicketCategory = (typeof TICKET_CATEGORIES)[number];

export class CreateTicketDto {
  @IsOptional()
  @IsUUID()
  service_id?: string;

  @IsIn(TICKET_CATEGORIES as unknown as string[], { message: 'Elige el tipo de problema' })
  category: TicketCategory;

  @IsString()
  @IsNotEmpty({ message: 'Cuéntanos qué pasó' })
  @MinLength(10, { message: 'Describe el problema con un poco más de detalle' })
  @MaxLength(2000)
  description: string;
}

export class UpdateTicketDto {
  @IsIn(['open', 'in_review', 'resolved'])
  status: 'open' | 'in_review' | 'resolved';

  @IsOptional()
  @IsString()
  @MaxLength(2000)
  resolution?: string;
}
