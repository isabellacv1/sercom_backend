import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { SupabaseModule } from '../supabase/supabase.module';
import { PushNotificationsModule } from '../push-notifications/push-notifications.module';
import { PaymentsController, PaymentsWebhookController } from './payments.controller';
import { PaymentsService } from './payments.service';
import { WompiService } from './wompi.service';
import { PayoutAccountService } from './payout-account.service';
import { MembershipsService } from './memberships.service';
import { MembershipsController } from './memberships.controller';
import { TipsService } from './tips.service';
import { TipsController } from './tips.controller';
import { CouponsService } from './coupons.service';
import { CreditsService } from './credits.service';
import { ReferralsService } from './referrals.service';
import { PromotionsController } from './promotions.controller';

@Module({
  imports: [ConfigModule, SupabaseModule, PushNotificationsModule],
  controllers: [PaymentsController, PaymentsWebhookController, MembershipsController, TipsController, PromotionsController],
  providers: [PaymentsService, WompiService, PayoutAccountService, MembershipsService, TipsService, CouponsService, CreditsService, ReferralsService],
  exports: [PaymentsService],
})
export class PaymentsModule {}
