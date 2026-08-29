import { Body, Controller, Get, HttpCode, Param, ParseIntPipe, Post, Query, UseGuards } from '@nestjs/common';
import { CurrentUser, IdempotencyKey, StepUpToken } from '../../../common/decorators';
import { JwtAuthGuard } from '../../../common/guards/jwt-auth.guard';
import { GroupPaymentsService } from './group-payments.service';
import { CreateGroupTransferDto } from './dto';

@Controller('group-transfers')
@UseGuards(JwtAuthGuard)
export class GroupPaymentsController {
  constructor(private readonly groupPayments: GroupPaymentsService) {}

  @Post()
  @HttpCode(201)
  create(
    @CurrentUser() user: { id: number },
    @Body() dto: CreateGroupTransferDto,
    @IdempotencyKey() idemKey?: string,
    @StepUpToken() stepUpToken?: string,
  ) {
    return this.groupPayments.create({
      senderId: user.id,
      title: dto.title,
      items: dto.items,
      idemKey,
      stepUpToken,
    });
  }

  @Get('mine')
  listMine(
    @CurrentUser() user: { id: number },
    @Query('cursor') cursor?: string,
    @Query('limit') limit?: string,
  ) {
    return this.groupPayments.listMine(
      user.id,
      cursor ? parseInt(cursor, 10) : undefined,
      limit ? parseInt(limit, 10) : 20,
    );
  }

  @Get(':id')
  getById(
    @CurrentUser() user: { id: number },
    @Param('id', ParseIntPipe) id: number,
  ) {
    return this.groupPayments.getById(user.id, id);
  }
}
