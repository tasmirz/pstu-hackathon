import { Controller, Get, Param, ParseIntPipe, Query, UseGuards } from '@nestjs/common';
import { CurrentUser } from '../../common/decorators';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { TransactionListQueryDto, UserLookupQueryDto } from './dto';
import { QueryService } from './query.service';

@UseGuards(JwtAuthGuard)
@Controller()
export class QueryController {
  constructor(private readonly queries: QueryService) {}

  @Get('accounts/me/balance')
  balance(@CurrentUser() user: { id: number }) {
    return this.queries.balance(user.id);
  }

  @Get('accounts/me/limits')
  limits(@CurrentUser() user: { id: number }) {
    return this.queries.limits(user.id);
  }

  @Get('transactions')
  transactions(@CurrentUser() user: { id: number }, @Query() query: TransactionListQueryDto) {
    return this.queries.transactions(user.id, query);
  }

  @Get('transactions/:id')
  transaction(@CurrentUser() user: { id: number }, @Param('id', ParseIntPipe) id: number) {
    return this.queries.transaction(user.id, id);
  }

  @Get('users/lookup')
  lookup(@CurrentUser() user: { id: number }, @Query() query: UserLookupQueryDto) {
    return this.queries.lookupUser(user.id, query.phone);
  }
}
