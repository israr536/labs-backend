import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { LabsModule } from '../labs/labs.module';
import { UsersController } from './users.controller';
import { UsersService } from './users.service';

@Module({
  imports: [AuthModule, LabsModule],
  controllers: [UsersController],
  providers: [UsersService],
})
export class UsersModule {}
