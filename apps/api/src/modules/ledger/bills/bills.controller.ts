import { Body, Controller, Get, HttpCode, Param, ParseIntPipe, Post, Query, UseGuards } from '@nestjs/common';
import { CurrentUser, IdempotencyKey, StepUpToken } from '../../../common/decorators';
import { JwtAuthGuard } from '../../../common/guards/jwt-auth.guard';
import { BillsService } from './bills.service';
import { CreateBillDto } from './dto';

@Controller('bills')
@UseGuards(JwtAuthGuard)
export class BillsController {
  constructor(private readonly bills: BillsService) {}

  @Post()
  @HttpCode(201)
  create(@CurrentUser() user: { id: number }, @Body() dto: CreateBillDto) {
    return this.bills.create(
      user.id,
      dto.title,
      dto.shares.map((s) => ({
        phone: s.phone,
        amount_paisa: s.amount_paisa,
      })),
    );
  }

  @Get('mine')
  listMine(
    @CurrentUser() user: { id: number },
    @Query('role') role?: 'created' | 'owed',
    @Query('state') state?: string,
    @Query('cursor') cursor?: string,
    @Query('limit') limit?: string,
  ) {
    return this.bills.listMine(
      user.id,
      role || 'created',
      state,
      cursor ? parseInt(cursor, 10) : undefined,
      limit ? parseInt(limit, 10) : 20,
    );
  }

  @Get(':id')
  getById(@Param('id', ParseIntPipe) id: number) {
    return this.bills.getById(id);
  }

  @Post(':id/pay')
  pay(
    @CurrentUser() user: { id: number },
    @Param('id', ParseIntPipe) id: number,
    @IdempotencyKey() idemKey: string,
    @StepUpToken() stepUpToken?: string,
  ) {
    return this.bills.pay({
      payerId: user.id,
      billId: id,
      idemKey,
      stepUpToken,
    });
  }

  @Post(':id/cancel')
  cancel(@CurrentUser() user: { id: number }, @Param('id', ParseIntPipe) id: number) {
    return this.bills.cancel(user.id, id);
  }
}
