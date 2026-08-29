import { Module } from '@nestjs/common';
import { TransfersController } from './transfers.controller';
import { TransfersService } from './transfers.service';
import { LEDGER_WRITER_PORT } from '../core/ledger-writer.port';
import { LedgerWriterService } from '../core/ledger-writer.service';
import { AccountsRepository } from '../core/accounts.repository';
import { UsersRepository } from '../core/users.repository';

@Module({
  controllers: [TransfersController],
  providers: [
    TransfersService,
    AccountsRepository,
    UsersRepository,
    {
      provide: LEDGER_WRITER_PORT,
      useClass: LedgerWriterService,
    },
  ],
  exports: [TransfersService],
})
export class TransfersModule {}
