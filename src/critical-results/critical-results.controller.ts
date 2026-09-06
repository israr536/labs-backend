import { Body, Controller, Get, Param, Patch, Req, UseGuards } from '@nestjs/common';
import { CriticalResultsService } from './critical-results.service';
import { AuthGuard } from '@nestjs/passport';

@Controller('critical-results')
@UseGuards(AuthGuard('jwt'))
export class CriticalResultsController {
  constructor(private readonly service: CriticalResultsService) {}

  @Get('pending')
  listPending(@Req() req: any) {
    return this.service.listPending(req.user.labId);
  }

  @Patch(':id/acknowledge')
  acknowledge(@Req() req: any, @Param('id') id: string, @Body() body: { note?: string }) {
    return this.service.acknowledge(req.user.labId, id, req.user.id, body?.note);
  }

  @Patch(':id/notification-attempt')
  notificationAttempt(
    @Req() req: any,
    @Param('id') id: string,
    @Body() body: { method: string; successful: boolean; recipient?: string; note?: string },
  ) {
    return this.service.recordNotificationAttempt(req.user.labId, id, req.user.id, body);
  }
}
