import {
  IsBoolean,
  IsDateString,
  IsIn,
  IsInt,
  IsNotEmpty,
  IsNumber,
  IsOptional,
  IsString,
  IsUUID,
  Matches,
  MaxLength,
  Min,
} from 'class-validator';

export class CreateCouponDto {
  @IsString()
  @Matches(/^[A-Za-z0-9]{3,20}$/, { message: 'El código debe tener de 3 a 20 letras o números' })
  code: string;

  @IsOptional()
  @IsString()
  @MaxLength(160)
  description?: string;

  @IsIn(['percent', 'fixed'])
  discount_type: 'percent' | 'fixed';

  @IsNumber()
  @Min(1)
  discount_value: number;

  @IsOptional()
  @IsNumber()
  @Min(0)
  max_discount?: number;

  @IsOptional()
  @IsNumber()
  @Min(0)
  min_amount?: number;

  @IsOptional()
  @IsBoolean()
  first_service_only?: boolean;

  @IsOptional()
  @IsUUID()
  category_id?: string;

  @IsOptional()
  @IsDateString()
  ends_at?: string;

  @IsOptional()
  @IsInt()
  @Min(1)
  max_redemptions?: number;
}

export class UpdateActiveDto {
  @IsBoolean()
  active: boolean;
}

export class CreateBannerDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(60)
  title: string;

  @IsOptional()
  @IsString()
  @MaxLength(140)
  subtitle?: string;

  @IsString()
  @IsNotEmpty()
  @MaxLength(30)
  cta_label: string;

  @IsIn(['coupon', 'plus', 'pro', 'url', 'referral'])
  action_type: string;

  @IsOptional()
  @IsString()
  @MaxLength(60)
  action_value?: string;

  @IsOptional()
  @IsIn(['client', 'worker', 'all'])
  audience?: string;

  @IsOptional()
  @IsIn(['water_drop', 'workspace_premium', 'celebration', 'card_giftcard', 'local_offer'])
  icon?: string;

  @IsOptional()
  @IsDateString()
  ends_at?: string;

  @IsOptional()
  @IsInt()
  sort_order?: number;
}
