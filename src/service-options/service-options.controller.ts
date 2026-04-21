import { Controller, Get, Param, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { ServiceOptionsService } from './service-options.service';

@UseGuards(JwtAuthGuard)
@Controller('service-options')
export class ServiceOptionsController {
  constructor(private readonly serviceOptionsService: ServiceOptionsService) {}

  @Get('category/:categoryId')
  findByCategory(@Param('categoryId') categoryId: string) {
    return this.serviceOptionsService.findByCategory(categoryId);
  }
}