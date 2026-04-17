import { Body, Controller, Get, Param, Post, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import * as currentUserDecorator from '../auth/decorators/current-user.decorator';
import { CreateServiceDto } from './dto/create-service.dto';
import { ServicesService } from './services.service';
import { Patch } from '@nestjs/common';
import { AssignWorkerDto } from './dto/assign-worker.dto';
import { UpdateServiceStatusDto } from './dto/update-service-status.dto';
import { CreatePreServiceRequestDto } from './dto/create-pre-service-request.dto';
import { UpdatePreServiceRequestDetailsDto } from './dto/update-pre-service-request-details.dto';

@UseGuards(JwtAuthGuard)
@Controller('services')
export class ServicesController {
  constructor(private readonly servicesService: ServicesService) {}

  @Patch(':id/assign-worker')
  assignWorker(
    @currentUserDecorator.CurrentUser() user: currentUserDecorator.JwtUser,
    @Param('id') id: string,
    @Body() dto: AssignWorkerDto,
  ) {
    return this.servicesService.assignWorker(user.sub, id, dto.worker_id);
  }

  @Post('pre-request')
  createPreRequest(
    @currentUserDecorator.CurrentUser() user: currentUserDecorator.JwtUser,
    @Body() dto: CreatePreServiceRequestDto,
  ) {
    return this.servicesService.createPreRequest(user.sub, dto);
  }

  @Patch(':id/pre-request-details')
  updatePreRequestDetails(
    @currentUserDecorator.CurrentUser() user: currentUserDecorator.JwtUser,
    @Param('id') id: string,
    @Body() dto: UpdatePreServiceRequestDetailsDto,
  ) {
    return this.servicesService.updatePreRequestDetails(user.sub, id, dto);
  }

  @Patch(':id/status')
  updateStatus(
    @currentUserDecorator.CurrentUser() user: currentUserDecorator.JwtUser,
    @Param('id') id: string,
    @Body() dto: UpdateServiceStatusDto,
  ) {
    return this.servicesService.updateStatus(user.sub, id, dto.status);
  }

  @Get(':id/status-history')
  findStatusHistory(
    @currentUserDecorator.CurrentUser() user: currentUserDecorator.JwtUser,
    @Param('id') id: string,
  ) {
    return this.servicesService.findStatusHistory(user.sub, id);
  }

  @Post()
  create(
    @currentUserDecorator.CurrentUser() user: currentUserDecorator.JwtUser,
    @Body() createServiceDto: CreateServiceDto,
  ) {
    return this.servicesService.create(user.sub, createServiceDto);
  }

  @Get('me')
  findMine(
    @currentUserDecorator.CurrentUser() user: currentUserDecorator.JwtUser,
  ) {
    return this.servicesService.findMine(user.sub);
  }

  @Get('me/:id')
  findOneMine(
    @currentUserDecorator.CurrentUser() user: currentUserDecorator.JwtUser,
    @Param('id') id: string,
  ) {
    return this.servicesService.findOneMine(user.sub, id);
  }

  @Get(':id/candidate-workers')
  findCandidateWorkers(
    @currentUserDecorator.CurrentUser() user: currentUserDecorator.JwtUser,
    @Param('id') id: string,
  ) {
    return this.servicesService.findCandidateWorkers(user.sub, id);
  }
}
