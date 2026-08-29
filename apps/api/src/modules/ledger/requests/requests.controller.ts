import { Body, Controller, Get, HttpCode, Param, ParseIntPipe, Post, Query, UseGuards } from '@nestjs/common';
import { CurrentUser, IdempotencyKey, StepUpToken } from '../../../common/decorators';
import { JwtAuthGuard } from '../../../common/guards/jwt-auth.guard';
import { CreateMoneyRequestDto } from './dto';
import { RequestsService } from './requests.service';

@Controller('money-requests')
@UseGuards(JwtAuthGuard)
export class RequestsController {
  constructor(private readonly requests: RequestsService) {}

  @Get('incoming')
  listIncoming(
    @CurrentUser() user: { id: number },
    @Query('state') state?: string,
    @Query('cursor') cursor?: string,
    @Query('limit') limit?: string,
  ) {
    return this.requests.listIncoming(
      user.id,
      state,
      cursor ? parseInt(cursor, 10) : undefined,
      limit ? parseInt(limit, 10) : 20,
    );
  }

  @Get('outgoing')
  listOutgoing(
    @CurrentUser() user: { id: number },
    @Query('state') state?: string,
    @Query('cursor') cursor?: string,
    @Query('limit') limit?: string,
  ) {
    return this.requests.listOutgoing(
      user.id,
      state,
      cursor ? parseInt(cursor, 10) : undefined,
      limit ? parseInt(limit, 10) : 20,
    );
  }

  @Post()
  @HttpCode(201)
  create(@CurrentUser() user: { id: number }, @Body() dto: CreateMoneyRequestDto) {
    return this.requests.create(user.id, dto.from_phone, dto.amount_paisa, dto.note);
  }

  @Post(':id/pay')
  @HttpCode(200)
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
  @HttpCode(200)
  decline(@CurrentUser() user: { id: number }, @Param('id', ParseIntPipe) id: number) {
    return this.requests.decline(user.id, id);
  }

  @Post(':id/cancel')
  @HttpCode(200)
  cancel(@CurrentUser() user: { id: number }, @Param('id', ParseIntPipe) id: number) {
    return this.requests.cancel(user.id, id);
  }

  @Post(':id/remind')
  @HttpCode(200)
  remind(@CurrentUser() user: { id: number }, @Param('id', ParseIntPipe) id: number) {
    return this.requests.remind(user.id, id);
  }
}
