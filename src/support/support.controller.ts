import { Body, Controller, Get, Param, ParseUUIDPipe, Patch, Post, Query } from '@nestjs/common';
import { Auth } from '../auth/decorators/auth.decorator';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import type { JwtUser } from '../auth/decorators/current-user.decorator';
import { AppRoles } from '../auth/interfaces/app-roles';
import { CreateTicketDto, UpdateTicketDto } from './dto/create-ticket.dto';
import { SupportService } from './support.service';

@Controller('support/tickets')
export class SupportController {
  constructor(private readonly support: SupportService) {}

  @Auth()
  @Post()
  create(@CurrentUser() user: JwtUser, @Body() dto: CreateTicketDto) {
    return this.support.create(user.sub, dto);
  }

  @Auth()
  @Get('me')
  listMine(@CurrentUser() user: JwtUser) {
    return this.support.listMine(user.sub);
  }

  @Auth(AppRoles.ADMIN)
  @Get()
  listAll(@Query('status') status?: string) {
    return this.support.listAll(status);
  }

  @Auth(AppRoles.ADMIN)
  @Patch(':id')
  update(@Param('id', ParseUUIDPipe) id: string, @Body() dto: UpdateTicketDto) {
    return this.support.update(id, dto);
  }
}
