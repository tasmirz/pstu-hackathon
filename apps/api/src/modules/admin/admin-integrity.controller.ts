import { Body, Controller, Get, HttpCode, Param, ParseIntPipe, Post, UseGuards } from '@nestjs/common';
import { CurrentUser, StepUpToken } from '../../common/decorators';
import { AdminGuard } from '../../common/guards/admin.guard';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { requireStepUp } from '../../common/step-up.util';
import { AdminIntegrityService } from './admin-integrity.service';
import { AdminAccountStatusDto } from './dto';

@Controller('admin')
@UseGuards(JwtAuthGuard, AdminGuard)
export class AdminIntegrityController {
  constructor(private readonly admin: AdminIntegrityService) {}

  @Get('integrity')
  integrity() {
    return this.admin.integrity();
  }

  @Post('accounts/:id/freeze')
  @HttpCode(200)
  freeze(
    @CurrentUser() user: { id: number },
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: AdminAccountStatusDto,
    @StepUpToken() stepUpToken?: string,
  ) {
    requireStepUp({ userId: user.id, token: stepUpToken, reason: 'ADMIN_ACCOUNT_FREEZE', always: true });
    return this.admin.setAccountStatus({
      accountOwnerId: id,
      adminId: user.id,
      status: 'FROZEN',
      reason: dto.reason,
    });
  }

  @Post('accounts/:id/unfreeze')
  @HttpCode(200)
  unfreeze(
    @CurrentUser() user: { id: number },
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: AdminAccountStatusDto,
    @StepUpToken() stepUpToken?: string,
  ) {
    requireStepUp({ userId: user.id, token: stepUpToken, reason: 'ADMIN_ACCOUNT_UNFREEZE', always: true });
    return this.admin.setAccountStatus({
      accountOwnerId: id,
      adminId: user.id,
      status: 'ACTIVE',
      reason: dto.reason,
    });
  }
}
