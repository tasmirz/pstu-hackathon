import { Body, Controller, HttpCode, Param, ParseIntPipe, Post, UseGuards } from '@nestjs/common';
import { CurrentUser, IdempotencyKey, StepUpToken } from '../../../common/decorators';
import { JwtAuthGuard } from '../../../common/guards/jwt-auth.guard';
import { CreateMoneyRequestDto } from './dto';
import { RequestsService } from './requests.service';

@Controller('money-requests')
@UseGuards(JwtAuthGuard)
export class RequestsController {
  constructor(private readonly requests: RequestsService) {}

  @Post()
  @HttpCode(201)
  create(@CurrentUser() user: { id: number }, @Body() dto: CreateMoneyRequestDto) {
    return this.requests.create(user.id, dto.from_phone, dto.amount_paisa, dto.note);
  }

  @Post(':id/pay')
  pay(
    @CurrentUser() user: { id: number },
    @Param('id', ParseIntPipe) id: number,
    @IdempotencyKey() idemKey: string,
    @StepUpToken() stepUpToken?: string,
  ) {
    return this.requests.pay({
      payerId: user.id,
      requestId: id,
      idemKey,
      stepUpToken,
    });
  }

  @Post(':id/decline')
  decline(@CurrentUser() user: { id: number }, @Param('id', ParseIntPipe) id: number) {
    return this.requests.decline(user.id, id);
  }

  @Post(':id/cancel')
  cancel(@CurrentUser() user: { id: number }, @Param('id', ParseIntPipe) id: number) {
    return this.requests.cancel(user.id, id);
  }

  @Post(':id/remind')
  remind(@CurrentUser() user: { id: number }, @Param('id', ParseIntPipe) id: number) {
    return this.requests.remind(user.id, id);
  }
}
