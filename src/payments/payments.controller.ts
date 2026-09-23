import { Body, Controller, Headers, Post, Req, UseGuards } from '@nestjs/common';
import type { Request } from 'express';
import { AuthGuard } from '../auth/auth.guard';
import { CurrentUser } from '../auth/current-user.decorator';
import type { AuthUser } from '../auth/auth.types';
import { PaymentsService } from './payments.service';

type RawBodyRequest = Request & { rawBody?: Buffer };

@Controller('payments')
export class PaymentsController {
  constructor(private readonly paymentsService: PaymentsService) {}

  @UseGuards(AuthGuard)
  @Post('order')
  createOrder(@CurrentUser() user: AuthUser, @Body() body: Record<string, unknown>) {
    return this.paymentsService.createOrder(user.labId, user.id, body?.plan);
  }

  @UseGuards(AuthGuard)
  @Post('verify')
  verify(@CurrentUser() user: AuthUser, @Body() body: Record<string, unknown>) {
    return this.paymentsService.verifyPayment(user.labId, user.id, body);
  }

  @Post('webhook')
  webhook(
    @Req() request: RawBodyRequest,
    @Headers('x-razorpay-signature') signature?: string,
    @Headers('x-razorpay-event-id') eventId?: string,
  ) {
    if (!request.rawBody) throw new Error('Raw request body is unavailable');
    return this.paymentsService.webhook(request.rawBody, signature, eventId);
  }
}
