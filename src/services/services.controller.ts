import { Body, Controller, Get, Param, Post, UseGuards } from '@nestjs/common';
import { AuthGuard } from '../auth/auth.guard';
import { CurrentUser } from '../auth/current-user.decorator';
import { CreateServiceDto } from './dto/create-service.dto';
import { ServicesService } from './services.service';

type JwtUser = {
  sub: string;
  email?: string;
  role?: string;
};

@UseGuards(AuthGuard)
@Controller('services')
export class ServicesController {
  constructor(private readonly servicesService: ServicesService) {}

  @Post()
  create(
    @CurrentUser() user: JwtUser,
    @Body() createServiceDto: CreateServiceDto,
  ) {
    return this.servicesService.create(user.sub, createServiceDto);
  }

  @Get('me')
  findMine(@CurrentUser() user: JwtUser) {
    return this.servicesService.findMine(user.sub);
  }

  @Get('me/:id')
  findOneMine(@CurrentUser() user: JwtUser, @Param('id') id: string) {
    return this.servicesService.findOneMine(user.sub, id);
  }
}
