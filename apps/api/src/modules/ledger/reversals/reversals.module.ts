import { Module } from '@nestjs/common';
import { ReversalsController } from './reversals.controller';
import { ReversalsService } from './reversals.service';
import { ReversalCoreService } from '../core/reversal-core.service';
import { LEDGER_WRITER_PORT } from '../core/ledger-writer.port';
import { LedgerWriterService } from '../core/ledger-writer.service';
import { AccountsRepository } from '../core/accounts.repository';
import { UsersRepository } from '../core/users.repository';

@Module({
  controllers: [ReversalsController],
  providers: [
    ReversalsService,
    ReversalCoreService,
    AccountsRepository,
    UsersRepository,
    {
      provide: LEDGER_WRITER_PORT,
      useClass: LedgerWriterService,
    },
  ],
  exports: [ReversalsService],
})
export class ReversalsModule {}
