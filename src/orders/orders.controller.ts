import { Body, Controller, Get, Param, Post, Query, UseGuards } from '@nestjs/common';
import { AuthGuard } from '../auth/auth.guard';
import { CurrentUser } from '../auth/current-user.decorator';
import type { AuthUser } from '../auth/auth.types';
import { OrdersService } from './orders.service';

@UseGuards(AuthGuard)
@Controller('orders')
export class OrdersController {
  constructor(private readonly ordersService: OrdersService) {}

  @Post()
  create(@CurrentUser() user: AuthUser, @Body() body: unknown) {
    return this.ordersService.create(user, body ?? {});
  }

  @Get()
  findAll(
    @CurrentUser() user: AuthUser,
    @Query('skip') skip?: string,
    @Query('take') take?: string,
  ) {
    const parsedSkip = skip === undefined ? 0 : Number(skip);
    const parsedTake = take === undefined ? 20 : Number(take);
    return this.ordersService.findAll(user, parsedSkip, parsedTake);
  }

  @Get(':id')
  findOne(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    return this.ordersService.findOne(user, id);
  }
}
