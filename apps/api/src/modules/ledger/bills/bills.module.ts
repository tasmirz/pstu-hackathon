import { Module } from '@nestjs/common';
import { BillsController } from './bills.controller';
import { BillsService } from './bills.service';
import { LEDGER_WRITER_PORT } from '../core/ledger-writer.port';
import { LedgerWriterService } from '../core/ledger-writer.service';
import { AccountsRepository } from '../core/accounts.repository';
import { UsersRepository } from '../core/users.repository';

@Module({
  controllers: [BillsController],
  providers: [
    BillsService,
    AccountsRepository,
    UsersRepository,
    {
      provide: LEDGER_WRITER_PORT,
      useClass: LedgerWriterService,
    },
  ],
  exports: [BillsService],
})
export class BillsModule {}
