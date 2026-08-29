import { Module } from '@nestjs/common';
import { AdminGuard } from '../../common/guards/admin.guard';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { DisputesModule } from '../ledger/disputes/disputes.module';
import { AdminDisputesController } from './admin-disputes.controller';
import { AdminIntegrityController } from './admin-integrity.controller';
import { AdminIntegrityService } from './admin-integrity.service';

@Module({
  imports: [DisputesModule],
  controllers: [AdminIntegrityController, AdminDisputesController],
  providers: [AdminIntegrityService, JwtAuthGuard, AdminGuard],
})
export class AdminModule {}
