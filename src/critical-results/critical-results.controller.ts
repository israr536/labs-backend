import { Body, Controller, Get, Param, Patch, Req, UseGuards } from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import { CriticalResultsService } from './critical-results.service';

@Controller('critical-results')
@UseGuards(AuthGuard('jwt'))
export class CriticalResultsController {
  constructor(private readonly service: CriticalResultsService) {}

  @Get('pending')
  listPending(@Req() req: any) {
    return this.service.listPending(req.user.labId);
  }

  @Get(':id')
  getOne(@Req() req: any, @Param('id') id: string) {
    return this.service.getOne(req.user.labId, id);
  }

  @Patch(':id/acknowledge')
  acknowledge(@Req() req: any, @Param('id') id: string, @Body() body: { note?: string }) {
    return this.service.acknowledge(req.user.labId, id, req.user.id, body?.note);
  }

  @Patch(':id/notification-attempt')
  notificationAttempt(
    @Req() req: any,
    @Param('id') id: string,
    @Body() body: {
      method: string;
      successful: boolean;
      recipient?: string;
      contactDetails?: string;
      readBackConfirmed?: boolean;
      note?: string;
    },
  ) {
    return this.service.recordNotificationAttempt(req.user.labId, id, req.user.id, body);
  }
}
