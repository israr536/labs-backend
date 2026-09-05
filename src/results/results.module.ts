import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { PrismaModule } from '../prisma/prisma.module';
import { ReferenceRangesModule } from '../reference-ranges/reference-ranges.module';
import { ResultsController } from './results.controller';
import { ResultsService } from './results.service';

@Module({
  imports: [AuthModule, PrismaModule, ReferenceRangesModule],
  controllers: [ResultsController],
  providers: [ResultsService],
})
export class ResultsModule {}
