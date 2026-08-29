import { Body, Controller, Get, HttpCode, Post, UseGuards } from '@nestjs/common';
import { CurrentUser } from '../../../common/decorators';
import { JwtAuthGuard } from '../../../common/guards/jwt-auth.guard';
import { DisputesService } from './disputes.service';
import { RaiseDisputeDto } from './dto';

@Controller('disputes')
@UseGuards(JwtAuthGuard)
export class DisputesController {
  constructor(private readonly disputes: DisputesService) {}

  @Post()
  @HttpCode(201)
  raise(@CurrentUser() user: { id: number }, @Body() dto: RaiseDisputeDto) {
    return this.disputes.raise(user.id, dto.txn_id, dto.reason);
  }

  @Get()
  listMine(@CurrentUser() user: { id: number }) {
    return this.disputes.listMine(user.id);
  }
}
