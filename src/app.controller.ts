import { Controller, Get } from '@nestjs/common';
import { AppService } from './app.service.ts';

@Controller()
export class AppController {
  constructor(private readonly appService: AppService) {}

  @Get('/')
  getHello() {
    return this.appService.getHello();
  }
  @Get('hi')
  hi() {
    return this.appService.getHello();
  }
}
