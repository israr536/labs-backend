import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { LabsModule } from '../labs/labs.module';
import { TestsController } from './tests.controller';
import { TestsService } from './tests.service';
import { TestCatalogController } from './test-catalog.controller';
import { TestCatalogService } from './test-catalog.service';

@Module({
  imports: [AuthModule, LabsModule],
  controllers: [TestsController, TestCatalogController],
  providers: [TestsService, TestCatalogService],
})
export class TestsModule {}
