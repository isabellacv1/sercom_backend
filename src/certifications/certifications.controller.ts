import {
  Body,
  Controller,
  Get,
  Param,
  ParseUUIDPipe,
  Post,
} from '@nestjs/common';
import { CertificationsService } from './certifications.service';
import { Auth } from '../auth/decorators/auth.decorator';
import { AppRoles } from '../auth/interfaces/app-roles';
import { CurrentUser, JwtUser } from '../auth/decorators/current-user.decorator';
import { CompleteModuleDto } from './dto/completed-module.dto';


@Controller('certifications')
export class CertificationsController {
  constructor(private readonly certificationsService: CertificationsService) {}

  @Get('workers/:workerId/completed')
  getWorkerCompletedCertifications(
    @Param('workerId', ParseUUIDPipe) workerId: string,
  ) {
    return this.certificationsService.getWorkerCompletedCertifications(workerId);
  }
  
  @Auth(AppRoles.WORKER)
  @Get('me/enrollments')
  getMyEnrollments(@CurrentUser() user: JwtUser) {
    return this.certificationsService.getMyEnrollments(user.sub);
  }

  @Auth(AppRoles.WORKER)
  @Get(':certificationId/me/progress')
  getMyProgress(
    @CurrentUser() user: JwtUser,
    @Param('certificationId', ParseUUIDPipe) certificationId: string,
  ) {
    return this.certificationsService.getMyProgress(user.sub, certificationId);
  }

  @Auth(AppRoles.WORKER)
  @Post(':certificationId/me/modules/complete')
  completeModule(
    @CurrentUser() user: JwtUser,
    @Param('certificationId', ParseUUIDPipe) certificationId: string,
    @Body() dto: CompleteModuleDto,
  ) {
    return this.certificationsService.completeModule(user.sub, certificationId, dto);
  }


  @Get()
  findAll(
    @Query('category') category?: string,
  ) {
    return this.certificationsService.findAll(category);
  }

  @Get(':id')
  findOne(
    @Param('id') id: string,
  ) {
    return this.certificationsService.findOne(id);
  }
}