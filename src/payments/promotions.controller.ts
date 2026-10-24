import { Body, Controller, Get, Post } from '@nestjs/common';
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
  ) {}

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
