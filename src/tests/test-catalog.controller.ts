import { Controller, Get, Param, Query, UseGuards } from '@nestjs/common';
import { AuthGuard } from '../auth/auth.guard';
import { CurrentUser } from '../auth/current-user.decorator';
import type { AuthUser } from '../auth/auth.types';
import { TestCatalogService } from './test-catalog.service';

@UseGuards(AuthGuard)
@Controller('test-catalog')
export class TestCatalogController {
  constructor(private readonly service: TestCatalogService) {}

  @Get()
  findAll(
    @CurrentUser() user: AuthUser,
    @Query('search') search?: string,
    @Query('category') category?: string,
    @Query('department') department?: string,
  ) {
    return this.service.findAll(user, { search, category, department });
  }

  @Get('categories')
  categories(@CurrentUser() user: AuthUser) {
    return this.service.categories(user);
  }

  @Get(':id')
  findOne(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    return this.service.findOne(user, id);
  }
}
