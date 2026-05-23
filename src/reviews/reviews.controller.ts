import { Body, Controller, Get, Param, Post } from '@nestjs/common';
import { ReviewsService } from './reviews.service';
import { Auth } from '../auth/decorators/auth.decorator';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import type { JwtUser } from '../auth/decorators/current-user.decorator';
import { CreateClientReviewDto } from './dto/create-client-review.dto';

@Controller('reviews')
export class ReviewsController {
  constructor(private readonly reviewsService: ReviewsService) {}

  @Auth()
  @Post('client')
  async createClientReview(
    @CurrentUser() user: JwtUser,
    @Body() dto: CreateClientReviewDto,
  ) {
    return this.reviewsService.createClientReview(user.sub, dto);
  }

  @Get('profile/:profileId')
  async getProfileReviews(@Param('profileId') profileId: string) {
    return this.reviewsService.getProfileReviews(profileId);
  }
}
