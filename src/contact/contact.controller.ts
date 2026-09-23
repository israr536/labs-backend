import { Body, Controller, HttpCode, HttpStatus, Post } from '@nestjs/common';
import { ContactService, type ContactInquiryBody } from './contact.service';

@Controller('contact')
export class ContactController {
  constructor(private readonly contactService: ContactService) {}
  

  @Post('inquiries')
  @HttpCode(HttpStatus.CREATED)
  createInquiry(@Body() body: ContactInquiryBody) {
    return this.contactService.createInquiry(body ?? {});
  }
}
