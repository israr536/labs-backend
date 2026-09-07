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

  @Roles(UserRole.ADMIN)
  @Post('enable-all')
  async enableAll(@CurrentUser() user: AuthUser) {
    const catalog = await this.service.findAll(user, {});
    const results: Array<{ id: string; code: string; name: string; status: 'enabled' | 'already-enabled' }> = [];

    // Process sequentially so subscription limits and per-lab uniqueness remain safe.
    for (const definition of catalog) {
      try {
        await this.testsService.cloneFromCatalog(user, definition.id, {});
        results.push({ id: definition.id, code: definition.code, name: definition.name, status: 'enabled' });
      } catch (error) {
        const message = error instanceof Error ? error.message : '';
        if (message.toLowerCase().includes('already exists')) {
          results.push({ id: definition.id, code: definition.code, name: definition.name, status: 'already-enabled' });
          continue;
        }
        throw error;
      }
    }

    return {
      total: catalog.length,
      enabled: results.filter((item) => item.status === 'enabled').length,
      alreadyEnabled: results.filter((item) => item.status === 'already-enabled').length,
      results,
    };
  }

  @Get(':id')
  findOne(@CurrentUser() user: AuthUser, @Param('id') id: string) { return this.service.findOne(user, id); }

  @Roles(UserRole.ADMIN)
  @Post(':id/enable')
  enable(@CurrentUser() user: AuthUser, @Param('id') id: string, @Body() body: unknown) {
    return this.testsService.cloneFromCatalog(user, id, (body ?? {}) as Record<string, unknown>);
  }
}
