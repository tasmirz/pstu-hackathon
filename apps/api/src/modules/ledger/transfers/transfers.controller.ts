import { Body, Controller, Param, ParseIntPipe, Post, Res, UseGuards } from '@nestjs/common';
import { Response } from 'express';
import { CurrentUser, IdempotencyKey, StepUpToken } from '../../../common/decorators';
import { JwtAuthGuard } from '../../../common/guards/jwt-auth.guard';
import { CreateTransferDto } from './dto';
import { TransfersService } from './transfers.service';

@Controller('transfers')
@UseGuards(JwtAuthGuard)
export class TransfersController {
  constructor(private readonly transfers: TransfersService) {}

  @Post()
  async create(
    @CurrentUser() user: { id: number },
    @Body() dto: CreateTransferDto,
    @IdempotencyKey() idemKey: string,
    @StepUpToken() stepUpToken: string | undefined,
    @Res({ passthrough: true }) res: Response,
  ) {
    const result = await this.transfers.transfer({
      senderId: user.id,
      toPhone: dto.to_phone,
      amountPaisa: dto.amount_paisa,
      note: dto.note,
      idemKey,
      stepUpToken,
    });

    if ((result as any)?.transaction?.state === 'HELD') {
      res.status(202);
    } else {
      res.status(201);
    }

    return result;
  }

  @Post(':id/cancel')
  cancel(
    @CurrentUser() user: { id: number },
    @Param('id', ParseIntPipe) id: number,
    @IdempotencyKey() idemKey: string,
  ) {
    return this.transfers.cancel({
      senderId: user.id,
      txnId: id,
      idemKey,
    });
  }
}
