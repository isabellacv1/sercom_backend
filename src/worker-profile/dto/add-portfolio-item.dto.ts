import { IsString, IsIn, IsOptional, MaxLength, IsUrl } from 'class-validator';
 
export class AddPortfolioItemDto {
  @IsUrl({}, { message: 'file_url debe ser una URL válida' })
  file_url: string;
 
  @IsIn(['image', 'video'], { message: 'file_type debe ser image o video' })
  file_type: 'image' | 'video';
 
  @IsOptional()
  @IsString()
  @MaxLength(80, { message: 'El título no puede superar los 80 caracteres' })
  title?: string;
}
 
