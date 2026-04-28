import { Body, Controller, Get, Param, Post, Query, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import * as currentUserDecorator from '../auth/decorators/current-user.decorator';
import { CreateProposalDto } from './dto/create-proposal.dto';
import { ProposalResponseDto } from './dto/proposal-response.dto';
import { ProposalsService } from './proposals.service';

@UseGuards(JwtAuthGuard)
@Controller('proposals')
export class ProposalsController {
  constructor(private readonly proposalsService: ProposalsService) {}

  @Post()
  async create(
    @currentUserDecorator.CurrentUser() user: currentUserDecorator.JwtUser,
    @Body() createProposalDto: CreateProposalDto,
  ): Promise<{ message: string; proposal: ProposalResponseDto }> {
    return this.proposalsService.create(user.sub, createProposalDto);
  }

  @Get('service/:serviceId')
  async findByService(
    @currentUserDecorator.CurrentUser() user: currentUserDecorator.JwtUser,
    @Param('serviceId') serviceId: string,
  ): Promise<{ message: string; total: number; proposals: ProposalResponseDto[] }> {
    return this.proposalsService.findByServiceForClient(serviceId, user.sub);
  }
  @Get('mine')
  async findMine(
    @currentUserDecorator.CurrentUser() user: currentUserDecorator.JwtUser,
    @Query('status') status: 'pending' | 'accepted',
  ) {
    return this.proposalsService.findMineForWorker(user.sub, status);
  }

  @Post(':proposalId/accept')
  acceptProposal(
    @currentUserDecorator.CurrentUser() user: currentUserDecorator.JwtUser,
    @Param('proposalId') proposalId: string,
  ) {
    return this.proposalsService.acceptProposal(proposalId, user.sub);
  }
}
