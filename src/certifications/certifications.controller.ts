import {
  Controller,
  Get,
  Param,
  ParseUUIDPipe,
} from '@nestjs/common';
import { CertificationsService } from './certifications.service';


@Controller('certifications')
export class CertificationsController {
  constructor(private readonly certificationsService: CertificationsService) {}

  @Get('workers/:workerId/completed')
  getWorkerCompletedCertifications(
    @Param('workerId', ParseUUIDPipe) workerId: string,
  ) {
    return this.certificationsService.getWorkerCompletedCertifications(workerId);
  }
}