import {
  IsDateString,
  IsNotEmpty,
  IsOptional,
  IsString,
  MaxLength,
} from 'class-validator';

/** Título o certificado que el profesional aporta (SENA, universidad, etc.). */
export class CreateCredentialDto {
  @IsString()
  @IsNotEmpty({ message: 'Indica qué estudiaste o en qué te certificaste' })
  @MaxLength(120)
  title: string;

  @IsString()
  @IsNotEmpty({ message: 'Indica la institución que lo emitió' })
  @MaxLength(120)
  institution: string;

  @IsOptional()
  @IsDateString({}, { message: 'Fecha de expedición inválida' })
  issued_at?: string;

  @IsOptional()
  @IsDateString({}, { message: 'Fecha de vencimiento inválida' })
  expires_at?: string;
}
