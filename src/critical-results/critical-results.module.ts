import { Module } from '@nestjs/common';
import { CriticalResultsController } from './critical-results.controller';
import { CriticalResultsService } from './critical-results.service';
import { PrismaModule } from '../prisma/prisma.module';

@Module({
  imports: [PrismaModule],
  controllers: [CriticalResultsController],
  providers: [CriticalResultsService],
  exports: [CriticalResultsService],
})
export class CriticalResultsModule {}
