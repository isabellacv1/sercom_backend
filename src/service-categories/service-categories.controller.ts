import { Controller, Get, UseGuards } from '@nestjs/common';
import { AuthGuard } from '../auth/auth.guard';
import { ServiceCategoriesService } from './service-categories.service';

@UseGuards(AuthGuard)
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