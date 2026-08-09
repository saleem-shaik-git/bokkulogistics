import { Controller, Get, Param, ParseUUIDPipe, Query } from '@nestjs/common';
import { ApiOkResponse, ApiOperation, ApiQuery, ApiTags } from '@nestjs/swagger';

import { Public } from '../../common/decorators/public.decorator';
import type { PaginationQuery } from '../../common/pagination';
import { StoresService } from './stores.service';

@ApiTags('Stores')
@Public()
@Controller('stores')
export class StoresController {
  constructor(private readonly storesService: StoresService) {}

  @Get()
  @ApiOperation({
    summary: 'List active stores',
    description: 'Paginated list of ACTIVE stores.',
  })
  @ApiQuery({ name: 'page', required: false, example: 1 })
  @ApiQuery({ name: 'limit', required: false, example: 20, description: 'Max 100' })
  list(@Query() query: PaginationQuery) {
    return this.storesService.listActive(query);
  }

  @Get(':id')
  @ApiOperation({ summary: 'Get a store by id' })
  @ApiOkResponse({ description: 'Store detail' })
  get(@Param('id', ParseUUIDPipe) id: string) {
    return this.storesService.getActiveById(id);
  }

  @Get(':storeId/categories')
  @ApiOperation({
    summary: 'List store categories',
    description: 'All categories of an active store, ordered for browsing.',
  })
  categories(@Param('storeId', ParseUUIDPipe) storeId: string) {
    return this.storesService.getActiveCategories(storeId);
  }
}
