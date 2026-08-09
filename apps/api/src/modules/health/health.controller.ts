import { Controller, Get } from '@nestjs/common';
import { ApiOkResponse, ApiOperation, ApiTags } from '@nestjs/swagger';
import type { HealthCheckResult } from '@bokku/shared';

import { RawResponse } from '../../common/interceptors/transform.interceptor';
import { Public } from '../../common/decorators/public.decorator';
import { HealthService } from './health.service';

@ApiTags('Health')
@Public()
@Controller('health')
export class HealthController {
  constructor(private readonly healthService: HealthService) {}

  @Get()
  @RawResponse()
  @ApiOperation({
    summary: 'Service health check',
    description:
      'Reports liveness of the API itself plus connectivity probes for PostgreSQL and Redis. ' +
      'Always returns HTTP 200; inspect `status` and `services` for the result.',
  })
  @ApiOkResponse({
    description: 'Health snapshot',
    schema: {
      example: { status: 'ok', services: { api: 'up', database: 'up', redis: 'up' } },
    },
  })
  check(): Promise<HealthCheckResult> {
    return this.healthService.check();
  }
}
