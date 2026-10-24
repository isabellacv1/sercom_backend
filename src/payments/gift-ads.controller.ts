import { Body, Controller, Get, Post } from '@nestjs/common';
import { Auth } from '../auth/decorators/auth.decorator';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import type { JwtUser } from '../auth/decorators/current-user.decorator';
import { AppRoles } from '../auth/interfaces/app-roles';
import { GiftCardsService } from './gift-cards.service';
import { AdsService } from './ads.service';
import { BuyBoostDto, BuyGiftCardDto, RedeemGiftCardDto } from './dto/gift-and-ads.dto';

@Controller()
export class GiftAdsController {
  constructor(
    private readonly giftCards: GiftCardsService,
    private readonly ads: AdsService,
  ) {}

  // ─── Tarjetas de regalo ────────────────────────────────────────────────
  @Auth()
  @Post('gift-cards/checkout')
  buyGiftCard(@CurrentUser() user: JwtUser, @Body() dto: BuyGiftCardDto) {
    return this.giftCards.checkout(user.sub, dto);
  }

  @Auth()
  @Get('gift-cards/me')
  myGiftCards(@CurrentUser() user: JwtUser) {
    return this.giftCards.listMine(user.sub);
  }

  @Auth()
  @Post('gift-cards/redeem')
  redeemGiftCard(@CurrentUser() user: JwtUser, @Body() dto: RedeemGiftCardDto) {
    return this.giftCards.redeem(user.sub, dto.code);
  }

  // ─── SERCOM Ads (profesionales destacados) ─────────────────────────────
  @Auth(AppRoles.WORKER)
  @Get('ads/me')
  myAds(@CurrentUser() user: JwtUser) {
    return this.ads.getMine(user.sub);
  }

  @Auth(AppRoles.WORKER)
  @Post('ads/checkout')
  buyBoost(@CurrentUser() user: JwtUser, @Body() dto: BuyBoostDto) {
    return this.ads.checkout(user.sub, dto);
  }

  @Auth()
  @Get('ads/featured')
  featured() {
    return this.ads.featured();
  }
}
