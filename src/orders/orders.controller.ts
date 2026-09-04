import { BadRequestException, Body, Controller, Get, Param, Post, Query, UseGuards } from '@nestjs/common';
import { OrderStatus, UserRole } from '@prisma/client';
import { AuthGuard } from '../auth/auth.guard';
import { CurrentUser } from '../auth/current-user.decorator';
import type { AuthUser } from '../auth/auth.types';
import { Roles } from '../auth/roles.decorator';
import { RolesGuard } from '../auth/roles.guard';
import { OrdersService } from './orders.service';

@UseGuards(AuthGuard, RolesGuard)
@Controller('orders')
export class OrdersController {
  constructor(private readonly ordersService: OrdersService) {}

  @Roles(UserRole.ADMIN, UserRole.RECEPTIONIST)
  @Post()
  create(@CurrentUser() user: AuthUser, @Body() body: unknown) {
    return this.ordersService.create(user, body ?? {});
  }

  @Get()
  findAll(
    @CurrentUser() user: AuthUser,
    @Query('page') page?: string,
    @Query('limit') limit?: string,
    @Query('skip') skip?: string,
    @Query('take') take?: string,
    @Query('search') search?: string,
    @Query('status') status?: string,
  ) {
    const parsedLimit = limit !== undefined ? Number(limit) : take !== undefined ? Number(take) : 20;
    const parsedPage = page === undefined ? 1 : Number(page);
    const parsedSkip = skip === undefined ? (parsedPage - 1) * parsedLimit : Number(skip);
    const normalizedStatus = status?.trim() || undefined;
    if (normalizedStatus && !Object.values(OrderStatus).includes(normalizedStatus as OrderStatus)) {
      throw new BadRequestException(`Invalid order status: ${normalizedStatus}`);
    }
    return this.ordersService.findAll(user, parsedSkip, parsedLimit, search?.trim() || undefined, normalizedStatus as OrderStatus | undefined);
  }

  @Get(':id')
  findOne(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    return this.ordersService.findOne(user, id);
  }
}
