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
  UseGuards,
} from '@nestjs/common';
import { CustomersService } from './customers.service';
import { CustomerAuthGuard } from '../auth/guards/customer-auth.guard';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { AuthenticatedUser } from '../auth/strategies/jwt.strategy';
import { UpdateCustomerProfileDto } from './dto/update-customer-profile.dto';
import { CreateAddressDto } from './dto/create-address.dto';
import { UpdateAddressDto } from './dto/update-address.dto';

@Controller('customers/me')
@UseGuards(CustomerAuthGuard)
export class CustomersController {
  constructor(private readonly customersService: CustomersService) {}

  @Patch()
  updateProfile(@CurrentUser() user: AuthenticatedUser, @Body() dto: UpdateCustomerProfileDto) {
    return this.customersService.updateProfile(user.id, dto);
  }

  @Get('addresses')
  listAddresses(@CurrentUser() user: AuthenticatedUser) {
    return this.customersService.listAddresses(user.id);
  }

  @Post('addresses')
  createAddress(@CurrentUser() user: AuthenticatedUser, @Body() dto: CreateAddressDto) {
    return this.customersService.createAddress(user.id, dto);
  }

  @Patch('addresses/:addressId')
  updateAddress(
    @CurrentUser() user: AuthenticatedUser,
    @Param('addressId') addressId: string,
    @Body() dto: UpdateAddressDto,
  ) {
    return this.customersService.updateAddress(user.id, addressId, dto);
  }

  @Delete('addresses/:addressId')
  @HttpCode(HttpStatus.NO_CONTENT)
  removeAddress(@CurrentUser() user: AuthenticatedUser, @Param('addressId') addressId: string) {
    return this.customersService.removeAddress(user.id, addressId);
  }
}
