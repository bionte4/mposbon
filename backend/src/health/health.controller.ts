import { Controller, Get } from '@nestjs/common';
import { AppConfigService } from '../config/app-config.service';

@Controller('health')
export class HealthController {
  constructor(private readonly config: AppConfigService) {}

  @Get()
  getHealth() {
    return {
      ok: true,
      service: 'bonpos-api',
      deploymentMode: this.config.deploymentMode,
      licenseValidationMode: this.config.licenseValidationMode,
      features: {
        edgeSync: this.config.featureEdgeSync,
        hris: this.config.featureHris,
        offlinePos: this.config.featureOfflinePos,
      },
    };
  }
}
