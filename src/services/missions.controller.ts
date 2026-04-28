import { Controller, Get, Query } from '@nestjs/common';
import * as currentUserDecorator from '../auth/decorators/current-user.decorator';
import { ServicesService } from './services.service';
import { MissionResponseDto } from './dto/mission-response.dto';
import { Auth } from '../auth/decorators/auth.decorator';
import { AppRoles } from '../auth/interfaces/app-roles';
import { WorkerOpportunitiesResponseDto } from './dto/worker-opportunity-card.dto';

@Auth(AppRoles.WORKER)
@Controller('missions')
export class MissionsController {
  constructor(private readonly servicesService: ServicesService) {}

  @Get()
  async findAll(
    @Query('status') status: 'active' | 'in_progress' | 'history',
    @currentUserDecorator.CurrentUser() user: currentUserDecorator.JwtUser,
  ): Promise<MissionResponseDto[]> {
    return (await this.servicesService.findMissions(
      status,
      user.sub,
    )) as MissionResponseDto[];
  }

  @Get('opportunities')
  async findOpportunities(
    @currentUserDecorator.CurrentUser() user: currentUserDecorator.JwtUser,
  ): Promise<WorkerOpportunitiesResponseDto> {
    return this.servicesService.findAvailableOpportunities(user.sub);
  }
}
