import { Module } from '@nestjs/common';
import { GroupPaymentsController } from './group-payments.controller';
import { GroupPaymentsService } from './group-payments.service';
import { AccountsRepository } from '../core/accounts.repository';
import { UsersRepository } from '../core/users.repository';
import { LEDGER_WRITER_PORT } from '../core/ledger-writer.port';
import { LedgerWriterService } from '../core/ledger-writer.service';

@Module({
  controllers: [GroupPaymentsController],
  providers: [
    GroupPaymentsService,
    AccountsRepository,
    UsersRepository,
    {
      provide: LEDGER_WRITER_PORT,
      useClass: LedgerWriterService,
    },
  ],
  exports: [GroupPaymentsService],
})
export class GroupPaymentsModule {}
