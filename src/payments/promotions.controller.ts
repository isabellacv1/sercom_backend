import { Body, Controller, Get, Post, Query } from '@nestjs/common';
import { SupabaseService } from '../supabase/supabase.service';
import { Auth } from '../auth/decorators/auth.decorator';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import type { JwtUser } from '../auth/decorators/current-user.decorator';
import { CreditsService } from './credits.service';
import { ReferralsService } from './referrals.service';
import { ApplyReferralDto } from './dto/apply-referral.dto';

/** Saldo SERCOM e "Invita y gana". */
@Controller()
export class PromotionsController {
  constructor(
    private readonly credits: CreditsService,
    private readonly referrals: ReferralsService,
    private readonly supabaseService: SupabaseService,
  ) {}

  // GET /promotions/banners?audience=client — carrusel de promociones vigentes
  @Auth()
  @Get('promotions/banners')
  async banners(@Query('audience') audience?: string) {
    const target = audience === 'worker' ? 'worker' : 'client';
    const now = new Date().toISOString();
    const { data } = await this.supabaseService.sbRaw
      .from('promo_banners')
      .select('id, title, subtitle, cta_label, action_type, action_value, icon')
      .eq('active', true)
      .in('audience', [target, 'all'])
      .or(`starts_at.is.null,starts_at.lte.${now}`)
      .or(`ends_at.is.null,ends_at.gte.${now}`)
      .order('sort_order', { ascending: true });
    return { banners: data ?? [] };
  }

  // GET /credits/me — saldo y movimientos
  @Auth()
  @Get('credits/me')
  getCredits(@CurrentUser() user: JwtUser) {
    return this.credits.getMine(user.sub);
  }

  // GET /referrals/me — mi código, invitados y recompensas
  @Auth()
  @Get('referrals/me')
  getReferrals(@CurrentUser() user: JwtUser) {
    return this.referrals.getMine(user.sub);
  }

  // POST /referrals/apply { code } — usar el código de quien me invitó
  @Auth()
  @Post('referrals/apply')
  applyReferral(@CurrentUser() user: JwtUser, @Body() dto: ApplyReferralDto) {
    return this.referrals.apply(user.sub, dto.code);
  }
}
