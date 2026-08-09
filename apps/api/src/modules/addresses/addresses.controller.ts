import { Body, Controller, Delete, Get, Param, ParseUUIDPipe, Patch, Post } from '@nestjs/common';
import { ApiBearerAuth, ApiOkResponse, ApiOperation, ApiTags } from '@nestjs/swagger';
import type { PublicAddress } from '@bokku/shared';

import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { AddressesService } from './addresses.service';
import { CreateAddressDto, UpdateAddressDto } from './dto/addresses.dto';

/**
 * Saved delivery addresses (authenticated users, owner-scoped — another
 * user's address id behaves as if it does not exist).
 */
@ApiTags('Addresses')
@ApiBearerAuth('access-token')
@Controller('addresses')
export class AddressesController {
  constructor(private readonly addresses: AddressesService) {}

  @Get()
  @ApiOperation({ summary: 'List my addresses', description: 'Default address first.' })
  @ApiOkResponse({ description: 'The user’s saved addresses' })
  list(@CurrentUser('id') userId: string): Promise<PublicAddress[]> {
    return this.addresses.list(userId);
  }

  @Post()
  @ApiOperation({
    summary: 'Save a new address',
    description:
      'The first address becomes the default automatically. Latitude/longitude must be ' +
      'provided as a pair (optional — map picking arrives with MapsService).',
  })
  create(@CurrentUser('id') userId: string, @Body() dto: CreateAddressDto): Promise<PublicAddress> {
    return this.addresses.create(userId, dto);
  }

  @Patch(':id')
  @ApiOperation({
    summary: 'Update an address',
    description: 'Setting isDefault=true demotes the previous default atomically.',
  })
  update(
    @CurrentUser('id') userId: string,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateAddressDto,
  ): Promise<PublicAddress> {
    return this.addresses.update(userId, id, dto);
  }

  @Delete(':id')
  @ApiOperation({
    summary: 'Delete an address',
    description: 'Deleting the default promotes the most recent remaining address to default.',
  })
  remove(
    @CurrentUser('id') userId: string,
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<{ deleted: boolean }> {
    return this.addresses.remove(userId, id);
  }
}
