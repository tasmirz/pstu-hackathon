import { Body, Controller, Get, HttpCode, Param, ParseIntPipe, Post, Query, UseGuards } from '@nestjs/common';
import { CurrentUser, IdempotencyKey, StepUpToken } from '../../common/decorators';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { AdminGuard } from '../../common/guards/admin.guard';
import { DisputesService } from '../ledger/disputes/disputes.service';
import { ResolveDisputeDto } from '../ledger/disputes/dto';

@Controller('admin/disputes')
@UseGuards(JwtAuthGuard, AdminGuard)
export class AdminDisputesController {
  constructor(private readonly disputes: DisputesService) {}

  @Get()
  listQueue(
    @Query('state') state?: string,
    @Query('cursor') cursor?: string,
    @Query('limit') limit?: string,
  ) {
    return this.disputes.listQueue(
      state || 'OPEN',
      cursor ? parseInt(cursor, 10) : undefined,
      limit ? parseInt(limit, 10) : 20,
    );
  }

  @Get('recovery-cases')
  listRecoveryCases(@Query('debtor_id') debtorId?: string) {
    return this.disputes.listRecoveryCases(debtorId ? parseInt(debtorId, 10) : undefined);
  }

  @Post(':id/resolve')
  @HttpCode(200)
  resolve(
    @CurrentUser() user: { id: number },
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: ResolveDisputeDto,
    @IdempotencyKey() idemKey: string,
    @StepUpToken() stepUpToken?: string,
  ) {
    return this.disputes.resolve({
      adminId: user.id,
      disputeId: id,
      action: dto.action,
      resolution: dto.resolution,
      idemKey,
      stepUpToken,
    });
  }
}
