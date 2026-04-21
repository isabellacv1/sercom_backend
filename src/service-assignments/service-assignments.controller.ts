import {
  Body,
  Controller,
  Get,
  Param,
  Patch,
  Post,
  UseGuards,
} from '@nestjs/common';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { ServiceAssignmentsService } from './service-assignments.service';
import { CreateServiceAssignmentDto } from './dto/create-service-assignment.dto';
import { RespondServiceAssignmentDto } from './dto/respond-service-assignment.dto';

type JwtUser = {
  sub: string;
  email?: string;
  role?: string;
};

@UseGuards(JwtAuthGuard)
@Controller('service-assignments')
export class ServiceAssignmentsController {
  constructor(
    private readonly serviceAssignmentsService: ServiceAssignmentsService,
  ) {}

  @Post()
  create(
    @CurrentUser() user: JwtUser,
    @Body() dto: CreateServiceAssignmentDto,
  ) {
    return this.serviceAssignmentsService.create(user.sub, dto);
  }

  @Get('service/:serviceId')
  findByService(
    @Param('serviceId') serviceId: string,
    @CurrentUser() user: JwtUser,
  ) {
    return this.serviceAssignmentsService.findByService(serviceId, user.sub);
  }

  @Patch(':id/respond')
  respond(
    @Param('id') id: string,
    @CurrentUser() user: JwtUser,
    @Body() dto: RespondServiceAssignmentDto,
  ) {
    return this.serviceAssignmentsService.respond(id, user.sub, dto);
  }

  @Get('my-offers')
  findMyOffers(@CurrentUser() user: JwtUser) {
    return this.serviceAssignmentsService.findMyOffers(user.sub);
  }
}
