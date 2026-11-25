import { Controller, Get } from '@nestjs/common';
import { Policy } from './auth/policy.js';
import { AppService, type HealthResponseDTO } from './app.service.js';

@Controller()
export class AppController {
  constructor(private readonly appService: AppService) {}

  @Policy({ public: true })
  @Get('health')
  getHealth(): Promise<HealthResponseDTO> {
    return this.appService.getHealth();
  }
}
