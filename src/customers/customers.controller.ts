import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Patch,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import { CustomersService } from './customers.service';
import { CustomerAuthGuard } from '../auth/guards/customer-auth.guard';
import { StaffAuthGuard } from '../auth/guards/staff-auth.guard';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { AuthenticatedUser } from '../auth/strategies/jwt.strategy';
import { UpdateCustomerProfileDto } from './dto/update-customer-profile.dto';
import { CreateAddressDto } from './dto/create-address.dto';
import { UpdateAddressDto } from './dto/update-address.dto';
import { QueryCustomersDto } from './dto/query-customers.dto';

@Controller('customers')
export class CustomersController {
  constructor(private readonly customersService: CustomersService) {}

  // ---- Customer Self Routes ----

  @Get('me')
  @UseGuards(CustomerAuthGuard)
  getProfile(@CurrentUser() user: AuthenticatedUser) {
    return this.customersService.getProfile(user.id);
  }

  @Patch('me')
  @UseGuards(CustomerAuthGuard)
  updateProfile(@CurrentUser() user: AuthenticatedUser, @Body() dto: UpdateCustomerProfileDto) {
    return this.customersService.updateProfile(user.id, dto);
  }

  @Get('me/addresses')
  @UseGuards(CustomerAuthGuard)
  listAddresses(@CurrentUser() user: AuthenticatedUser) {
    return this.customersService.listAddresses(user.id);
  }

  @Post('me/addresses')
  @UseGuards(CustomerAuthGuard)
  createAddress(@CurrentUser() user: AuthenticatedUser, @Body() dto: CreateAddressDto) {
    return this.customersService.createAddress(user.id, dto);
  }

  @Patch('me/addresses/:addressId')
  @UseGuards(CustomerAuthGuard)
  updateAddress(
    @CurrentUser() user: AuthenticatedUser,
    @Param('addressId') addressId: string,
    @Body() dto: UpdateAddressDto,
  ) {
    return this.customersService.updateAddress(user.id, addressId, dto);
  }

  @Delete('me/addresses/:addressId')
  @UseGuards(CustomerAuthGuard)
  @HttpCode(HttpStatus.NO_CONTENT)
  removeAddress(@CurrentUser() user: AuthenticatedUser, @Param('addressId') addressId: string) {
    return this.customersService.removeAddress(user.id, addressId);
  }

  // ---- Staff Management Routes ----

  @Get()
  @UseGuards(StaffAuthGuard)
  findAll(@Query() query: QueryCustomersDto) {
    return this.customersService.findAll(query);
  }

  @Get(':id')
  @UseGuards(StaffAuthGuard)
  findOne(@Param('id') id: string) {
    return this.customersService.findOne(id);
  }

  @Delete(':id')
  @UseGuards(StaffAuthGuard)
  remove(@Param('id') id: string) {
    return this.customersService.remove(id);
  }
}

