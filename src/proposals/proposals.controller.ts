import {
  Body,
  Controller,
  Param,
  Patch,
  Post,
  UseGuards,
} from '@nestjs/common';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import * as currentUserDecorator from '../auth/decorators/current-user.decorator';
import { CreateProposalDto } from './dto/create-proposal.dto';
import { UpdateProposalDto } from './dto/update-proposal.dto';
import { ProposalsService } from './proposals.service';

@UseGuards(JwtAuthGuard)
@Controller('proposals')
export class ProposalsController {
  constructor(private readonly proposalsService: ProposalsService) {}

  @Patch(':id')
  update(
    @currentUserDecorator.CurrentUser() user: currentUserDecorator.JwtUser,
    @Param('id') id: string,
    @Body() dto: UpdateProposalDto,
  ) {
    return this.proposalsService.update(user.sub, id, dto);
  }

  @Post()
  create(
    @currentUserDecorator.CurrentUser() user: currentUserDecorator.JwtUser,
    @Body() createProposalDto: CreateProposalDto,
  ) {
    return this.proposalsService.create(user.sub, createProposalDto);
  }
}
