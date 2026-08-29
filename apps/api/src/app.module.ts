import { Module } from '@nestjs/common';
import { DbModule } from './db/db.module';
import { AdminModule } from './modules/admin/admin.module';
import { AuthModule } from './modules/auth/auth.module';
import { QueryModule } from './modules/query/query.module';
import { NotificationsModule } from './modules/notifications/notifications.module';
import { BillsModule } from './modules/ledger/bills/bills.module';
import { DisputesModule } from './modules/ledger/disputes/disputes.module';
import { GroupPaymentsModule } from './modules/ledger/group-payments/group-payments.module';
import { RequestsModule } from './modules/ledger/requests/requests.module';
import { ReversalsModule } from './modules/ledger/reversals/reversals.module';
import { TransfersModule } from './modules/ledger/transfers/transfers.module';

@Module({
  imports: [
    DbModule,
    AuthModule,
    QueryModule,
    NotificationsModule,
    TransfersModule,
    ReversalsModule,
    DisputesModule,
    RequestsModule,
    BillsModule,
    GroupPaymentsModule,
    AdminModule,
  ],
})
export class AppModule {}
