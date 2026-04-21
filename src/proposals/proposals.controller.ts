import { Body, Controller, Post, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import * as currentUserDecorator from '../auth/decorators/current-user.decorator';
import { CreateProposalDto } from './dto/create-proposal.dto';
import { ProposalsService } from './proposals.service';

@UseGuards(JwtAuthGuard)
@Controller('proposals')
export class ProposalsController {
  constructor(private readonly proposalsService: ProposalsService) {}

  @Post()
  create(
    @currentUserDecorator.CurrentUser() user: currentUserDecorator.JwtUser,
    @Body() createProposalDto: CreateProposalDto,
  ) {
    return this.proposalsService.create(user.sub, createProposalDto);
  }
}
