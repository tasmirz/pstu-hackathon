import { Body, Controller, HttpCode, Post, UseGuards } from '@nestjs/common';
import { CurrentUser, IdempotencyKey, StepUpToken } from '../../../common/decorators';
import { JwtAuthGuard } from '../../../common/guards/jwt-auth.guard';
import { CreateTransferDto } from './dto';
import { TransfersService } from './transfers.service';

@Controller('transfers')
@UseGuards(JwtAuthGuard)
export class TransfersController {
  constructor(private readonly transfers: TransfersService) {}

  @Post()
  @HttpCode(201)
  create(
    @CurrentUser() user: { id: number },
    @Body() dto: CreateTransferDto,
    @IdempotencyKey() idemKey: string,
    @StepUpToken() stepUpToken: string | undefined,
  ) {
    return this.transfers.transfer({
      senderId: user.id,
      toPhone: dto.to_phone,
      amountPaisa: dto.amount_paisa,
      note: dto.note,
      idemKey,
      stepUpToken,
    });
  }
}
