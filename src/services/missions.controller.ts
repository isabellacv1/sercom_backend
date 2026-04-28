import { Controller, Get, Query, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import * as currentUserDecorator from '../auth/decorators/current-user.decorator';
import { ServicesService } from './services.service';
import { MissionResponseDto } from './dto/mission-response.dto';

@UseGuards(JwtAuthGuard)
@Controller('missions')
export class MissionsController {
  constructor(private readonly servicesService: ServicesService) {}

  @Get()
  async findAll(
    @Query('status') status: 'active' | 'in_progress' | 'history',
    @currentUserDecorator.CurrentUser() user: currentUserDecorator.JwtUser,
  ): Promise<MissionResponseDto[]> {
    return this.servicesService.findMissions(status, user.sub);
  }
}
