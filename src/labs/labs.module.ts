import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { LabsController } from './labs.controller';
import { LabsService } from './labs.service';

@Module({
  imports: [AuthModule],
  controllers: [LabsController],
  providers: [LabsService],
})
export class LabsModule {}
