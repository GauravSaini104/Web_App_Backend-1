import { Body, Controller, Get, Param, Patch, Post, Query, UseGuards } from '@nestjs/common';
import { OrdersService } from './orders.service';
import { CreateOrderDto } from './dto/create-order.dto';
import { CancelOrderDto } from './dto/cancel-order.dto';
import { UpdateOrderStatusDto } from './dto/update-order-status.dto';
import { QueryOrdersDto } from './dto/query-orders.dto';
import { CustomerAuthGuard } from '../auth/guards/customer-auth.guard';
import { StaffAuthGuard } from '../auth/guards/staff-auth.guard';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { AuthenticatedUser } from '../auth/strategies/jwt.strategy';

@Controller('orders')
export class OrdersController {
  constructor(private readonly ordersService: OrdersService) {}

  // Public — lets the checkout screen show the real delivery fee before the
  // customer commits to placing the order, using the exact same config the
  // backend will actually charge against (never a guessed/hardcoded number
  // on the frontend that could drift from reality).
  // Must come before ':id' below — otherwise this would be matched as an id.
  @Get('delivery-fee-info')
  getDeliveryFeeInfo() {
    return this.ordersService.getDeliveryFeeInfo();
  }

  // ---- Customer routes ----

  @Post()
  @UseGuards(CustomerAuthGuard)
  create(@CurrentUser() user: AuthenticatedUser, @Body() dto: CreateOrderDto) {
    return this.ordersService.createOrder(user.id, dto);
  }

  // Must come before ':id' below — otherwise "mine" would be matched as an id.
  @Get('mine')
  @UseGuards(CustomerAuthGuard)
  findMineAll(@CurrentUser() user: AuthenticatedUser) {
    return this.ordersService.findMineAll(user.id);
  }

  @Get('mine/:id')
  @UseGuards(CustomerAuthGuard)
  findMineOne(@CurrentUser() user: AuthenticatedUser, @Param('id') id: string) {
    return this.ordersService.findMineOne(user.id, id);
  }

  @Post(':id/cancel')
  @UseGuards(CustomerAuthGuard)
  cancel(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id') id: string,
    @Body() dto: CancelOrderDto,
  ) {
    return this.ordersService.cancelOrder(user.id, id, dto);
  }

  // ---- Staff routes ----

  @Get()
  @UseGuards(StaffAuthGuard)
  findAll(@Query() query: QueryOrdersDto) {
    return this.ordersService.findAllForStaff(query);
  }

  @Get(':id')
  @UseGuards(StaffAuthGuard)
  findOne(@Param('id') id: string) {
    return this.ordersService.findOneForStaff(id);
  }

  @Post(':id/confirm-payment')
  @UseGuards(StaffAuthGuard)
  confirmPayment(@Param('id') id: string) {
    return this.ordersService.confirmPayment(id);
  }

  @Patch(':id/status')
  @UseGuards(StaffAuthGuard)
  updateStatus(@Param('id') id: string, @Body() dto: UpdateOrderStatusDto) {
    return this.ordersService.updateStatus(id, dto);
  }

  /** Temporary manual trigger until a real scheduler exists — see OrdersService. */
  @Post('cleanup-abandoned')
  @UseGuards(StaffAuthGuard)
  expireAbandonedOrders() {
    return this.ordersService.expireAbandonedOrders();
  }
}
