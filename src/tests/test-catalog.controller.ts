import { Body, Controller, Get, Param, Post, Query, UseGuards } from '@nestjs/common';
import { AuthGuard } from '../auth/auth.guard';
import { CurrentUser } from '../auth/current-user.decorator';
import type { AuthUser } from '../auth/auth.types';
import { Roles } from '../auth/roles.decorator';
import { RolesGuard } from '../auth/roles.guard';
import { UserRole } from '@prisma/client';
import { TestCatalogService } from './test-catalog.service';
import { TestsService } from './tests.service';
import { StarterTestsService } from './starter-tests.service';

@UseGuards(AuthGuard, RolesGuard)
@Controller('test-catalog')
export class TestCatalogController {
  constructor(
    private readonly service: TestCatalogService,
    private readonly testsService: TestsService,
    private readonly starterTestsService: StarterTestsService,
  ) {}

  @Get()
  findAll(@CurrentUser() user: AuthUser, @Query('search') search?: string, @Query('category') category?: string, @Query('department') department?: string) {
    return this.service.findAll(user, { search, category, department });
  }

  @Get('categories')
  categories(@CurrentUser() user: AuthUser) { return this.service.categories(user); }

  @Roles(UserRole.ADMIN)
  @Post('provision-defaults')
  provisionDefaults(@CurrentUser() user: AuthUser) {
    return this.starterTestsService.provision(user);
  }

  @Get(':id')
  findOne(@CurrentUser() user: AuthUser, @Param('id') id: string) { return this.service.findOne(user, id); }

  @Roles(UserRole.ADMIN)
  @Post(':id/enable')
  enable(@CurrentUser() user: AuthUser, @Param('id') id: string, @Body() body: unknown) {
    const overrides = (body ?? {}) as Record<string, unknown>;
    return this.testsService.cloneFromCatalog(user, id, overrides);
  }
}
