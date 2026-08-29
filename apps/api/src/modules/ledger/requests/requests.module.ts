import { Module } from '@nestjs/common';
import { RequestsController } from './requests.controller';
import { RequestsService } from './requests.service';
import { LEDGER_WRITER_PORT } from '../core/ledger-writer.port';
import { LedgerWriterService } from '../core/ledger-writer.service';
import { AccountsRepository } from '../core/accounts.repository';
import { UsersRepository } from '../core/users.repository';

@Module({
  controllers: [RequestsController],
  providers: [
    RequestsService,
    AccountsRepository,
    UsersRepository,
    {
      provide: LEDGER_WRITER_PORT,
      useClass: LedgerWriterService,
    },
  ],
  exports: [RequestsService],
})
export class RequestsModule {}
