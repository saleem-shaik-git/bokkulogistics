import { Controller, Get, Res } from '@nestjs/common';
import { ApiOkResponse, ApiOperation, ApiTags } from '@nestjs/swagger';
import type { HealthCheckResult } from '@bokku/shared';
import type { Response } from 'express';

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

  @Get('live')
  @RawResponse()
  @ApiOperation({
    summary: 'Liveness probe',
    description:
      'Is the API process running and serving? Touches no dependencies, so an infrastructure ' +
      'outage never restarts healthy pods. Always 200.',
  })
  @ApiOkResponse({
    description: 'Process is alive',
    schema: { example: { status: 'ok', services: { api: 'up' } } },
  })
  live(): HealthCheckResult {
    return this.healthService.liveness();
  }

  @Get('ready')
  @RawResponse()
  @ApiOperation({
    summary: 'Readiness probe',
    description:
      'Same dependency probes as /health, but returns HTTP 503 when PostgreSQL or Redis is ' +
      'unreachable so load balancers drain the instance instead of killing it.',
  })
  @ApiOkResponse({ description: 'Ready (all dependencies reachable)' })
  async ready(@Res({ passthrough: true }) res: Response): Promise<HealthCheckResult> {
    const result = await this.healthService.readiness();
    if (result.status !== 'ok') {
      res.status(503);
    }
    return result;
  }
}
