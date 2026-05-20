import { Body, Controller, Get, Param, ParseUUIDPipe, Post } from '@nestjs/common';
import { Auth } from '../auth/decorators/auth.decorator';
import {
  CurrentUser,
  JwtUser,
} from '../auth/decorators/current-user.decorator';
import { AppRoles } from '../auth/interfaces/app-roles';
import { CreateReviewDto } from './dto/create-review.dto';
import { ReviewsService } from './reviews.service';

@Controller()
export class ReviewsController {
  constructor(private readonly reviewsService: ReviewsService) {}

  @Auth(AppRoles.CLIENT)
  @Post('reviews')
  create(@CurrentUser() user: JwtUser, @Body() dto: CreateReviewDto) {
    return this.reviewsService.create(user.sub, dto);
  }

  @Auth()
  @Get('services/:serviceId/review')
  findByService(
    @CurrentUser() user: JwtUser,
    @Param('serviceId', ParseUUIDPipe) serviceId: string,
  ) {
    return this.reviewsService.findByServiceForUser(user.sub, serviceId);
  }

  @Auth(AppRoles.WORKER)
  @Get('worker-profile/me/reviews')
  findMine(@CurrentUser() user: JwtUser) {
    return this.reviewsService.findByWorker(user.sub, user.sub);
  }

  @Auth()
  @Get('workers/:workerId/reviews')
  findByWorker(
    @CurrentUser() user: JwtUser,
    @Param('workerId', ParseUUIDPipe) workerId: string,
  ) {
    return this.reviewsService.findByWorker(workerId, user.sub);
  }
}
