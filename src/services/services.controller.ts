import {
  Body,
  Controller,
  Get,
  Param,
  Post,
  Query,
  UploadedFiles,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import { FilesInterceptor } from '@nestjs/platform-express';
import { memoryStorage } from 'multer';
import type { MulterFile } from '../common/types/multer.types';
import {
  MAX_EVIDENCE_PER_SERVICE,
  ServiceEvidenceService,
} from './service-evidence.service';
import { LiveLocationService } from './live-location.service';
import { UpdateLocationDto } from './dto/update-location.dto';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import * as currentUserDecorator from '../auth/decorators/current-user.decorator';
import { CreateServiceDto } from './dto/create-service.dto';
import { ServicesService } from './services.service';
import { Patch } from '@nestjs/common';
import { AssignWorkerDto } from './dto/assign-worker.dto';
import { UpdateServiceStatusDto } from './dto/update-service-status.dto';
import { CreatePreServiceRequestDto } from './dto/create-pre-service-request.dto';
import { UpdatePreServiceRequestDetailsDto } from './dto/update-pre-service-request-details.dto';
import { FindOpportunitiesQueryDto } from './dto/find-opportunities-query.dto';

@UseGuards(JwtAuthGuard)
@Controller('services')
export class ServicesController {
  constructor(
    private readonly servicesService: ServicesService,
    private readonly evidenceService: ServiceEvidenceService,
    private readonly liveLocation: LiveLocationService,
  ) {}

  @Get('opportunities')
  findOpportunities(
    @currentUserDecorator.CurrentUser() user: currentUserDecorator.JwtUser,
    @Query() query: FindOpportunitiesQueryDto,
  ) {
    return this.servicesService.findOpportunities(user.sub, query);
  }

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

  // Evidencia del trabajo: obligatoria para pasar el servicio a "Finalizado".
  @Post(':id/evidence')
  @UseInterceptors(
    FilesInterceptor('files', MAX_EVIDENCE_PER_SERVICE, {
      storage: memoryStorage(),
    }),
  )
  uploadEvidence(
    @currentUserDecorator.CurrentUser() user: currentUserDecorator.JwtUser,
    @Param('id') id: string,
    @UploadedFiles() files: MulterFile[],
  ) {
    return this.evidenceService.upload(user.sub, id, files);
  }

  @Get(':id/evidence')
  listEvidence(
    @currentUserDecorator.CurrentUser() user: currentUserDecorator.JwtUser,
    @Param('id') id: string,
  ) {
    return this.evidenceService.list(user.sub, id);
  }

  // Ubicación en vivo del profesional mientras va en camino.
  @Post(':id/location')
  updateLocation(
    @currentUserDecorator.CurrentUser() user: currentUserDecorator.JwtUser,
    @Param('id') id: string,
    @Body() dto: UpdateLocationDto,
  ) {
    return this.liveLocation.update(user.sub, id, dto);
  }

  @Get(':id/location')
  getLocation(
    @currentUserDecorator.CurrentUser() user: currentUserDecorator.JwtUser,
    @Param('id') id: string,
  ) {
    return this.liveLocation.get(user.sub, id);
  }

  @Patch(':id/confirm')
  confirmCompletion(
    @currentUserDecorator.CurrentUser() user: currentUserDecorator.JwtUser,
    @Param('id') id: string,
  ) {
    return this.servicesService.confirmCompletion(user.sub, id);
  }

  @Patch(':id/cancel')
  cancelMission(
    @currentUserDecorator.CurrentUser() user: currentUserDecorator.JwtUser,
    @Param('id') id: string,
  ) {
    return this.servicesService.cancelMission(user.sub, id);
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

  @Get(':id/tracking')
  findForParticipant(
    @currentUserDecorator.CurrentUser() user: currentUserDecorator.JwtUser,
    @Param('id') id: string,
  ) {
    return this.servicesService.findForParticipant(user.sub, id);
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

  @Post(':id/dispute')
  reportDispute(
    @currentUserDecorator.CurrentUser() user: currentUserDecorator.JwtUser,
    @Param('id') id: string,
    @Body() body: { reason: string; description: string; photo_urls?: string[] },
  ) {
    return this.servicesService.reportDispute(user.sub, id, body);
  }
}
