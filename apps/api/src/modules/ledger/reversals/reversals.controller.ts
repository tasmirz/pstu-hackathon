import { Controller, HttpCode, Param, ParseIntPipe, Post, UseGuards } from '@nestjs/common';
import { CurrentUser, IdempotencyKey, StepUpToken } from '../../../common/decorators';
import { JwtAuthGuard } from '../../../common/guards/jwt-auth.guard';
import { ReversalsService } from './reversals.service';

@Controller('transactions')
@UseGuards(JwtAuthGuard)
export class ReversalsController {
  constructor(private readonly reversals: ReversalsService) {}

  @Post(':id/reverse')
  @HttpCode(201)
  reverse(
    @CurrentUser() user: { id: number },
    @Param('id', ParseIntPipe) id: number,
    @IdempotencyKey() idemKey: string,
    @StepUpToken() stepUpToken: string | undefined,
  ) {
    return this.reversals.reverse(user.id, id, idemKey, stepUpToken);
  }
}
