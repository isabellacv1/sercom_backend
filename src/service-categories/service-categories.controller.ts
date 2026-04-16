import { Controller, Get, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { ServiceCategoriesService } from './service-categories.service';

@UseGuards(JwtAuthGuard)
@Controller('service-categories')
export class ServiceCategoriesController {
  constructor(
    private readonly serviceCategoriesService: ServiceCategoriesService,
  ) {}

  @Get()
  findAll() {
    return this.serviceCategoriesService.findAll();
  }
}