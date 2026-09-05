import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { PrismaModule } from '../prisma/prisma.module';
import { ReferenceRangesController } from './reference-ranges.controller';
import { ReferenceRangesService } from './reference-ranges.service';

@Module({
  imports: [AuthModule, PrismaModule],
  controllers: [ReferenceRangesController],
  providers: [ReferenceRangesService],
  exports: [ReferenceRangesService],
})
export class ReferenceRangesModule {}
