import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { PrismaModule } from '../prisma/prisma.module';
import { ResultsController } from './results.controller';
import { ResultsService } from './results.service';

@Module({
  imports: [AuthModule, PrismaModule],
  controllers: [ResultsController],
  providers: [ResultsService],
})
export class ResultsModule {}
