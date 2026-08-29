import { Module } from '@nestjs/common';
import { DisputesController } from './disputes.controller';
import { DisputesService } from './disputes.service';
import { ReversalCoreService } from '../core/reversal-core.service';
import { LEDGER_WRITER_PORT } from '../core/ledger-writer.port';
import { LedgerWriterService } from '../core/ledger-writer.service';
import { AccountsRepository } from '../core/accounts.repository';
import { UsersRepository } from '../core/users.repository';

@Module({
  controllers: [DisputesController],
  providers: [
    DisputesService,
    ReversalCoreService,
    AccountsRepository,
    UsersRepository,
    {
      provide: LEDGER_WRITER_PORT,
      useClass: LedgerWriterService,
    },
  ],
  exports: [DisputesService],
})
export class DisputesModule {}
