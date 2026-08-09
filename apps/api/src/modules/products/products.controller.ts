import { Controller, Get, Param, ParseUUIDPipe, Query } from '@nestjs/common';
import { ApiOkResponse, ApiOperation, ApiQuery, ApiTags } from '@nestjs/swagger';

import { Public } from '../../common/decorators/public.decorator';
import { ProductsService, type ListProductsQuery } from './products.service';

@ApiTags('Products')
@Public()
@Controller()
export class ProductsController {
  constructor(private readonly productsService: ProductsService) {}

  @Get('stores/:storeId/products')
  @ApiOperation({
    summary: 'List products of a store',
    description:
      'Paginated, searchable (q), category-filterable list of ACTIVE in-catalog products. ' +
      'Prices are authoritative server-side values in kobo (integer minor units).',
  })
  @ApiQuery({ name: 'page', required: false, example: 1 })
  @ApiQuery({ name: 'limit', required: false, example: 20, description: 'Max 100' })
  @ApiQuery({ name: 'q', required: false, description: 'Search name/description' })
  @ApiQuery({ name: 'category', required: false, description: 'Category id or slug' })
  listForStore(
    @Param('storeId', ParseUUIDPipe) storeId: string,
    @Query() query: ListProductsQuery,
  ) {
    return this.productsService.listForStore(storeId, query);
  }

  @Get('products/:id')
  @ApiOperation({ summary: 'Get product detail with images and availability' })
  @ApiOkResponse({ description: 'Product detail' })
  get(@Param('id', ParseUUIDPipe) id: string) {
    return this.productsService.getPublicById(id);
  }
}
