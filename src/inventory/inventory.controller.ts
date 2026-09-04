import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Patch,
  Post,
  UseGuards,
} from '@nestjs/common';
import { InventoryService } from './inventory.service';
import { ReceiveStockDto } from './dto/receive-stock.dto';
import { AdjustStockDto } from './dto/adjust-stock.dto';
import { WriteOffStockDto } from './dto/write-off-stock.dto';
import { ReturnStockDto } from './dto/return-stock.dto';
import { CreateReservationDto } from './dto/create-reservation.dto';
import { UpdateInventorySettingsDto } from './dto/update-inventory-settings.dto';
import { StaffAuthGuard } from '../auth/guards/staff-auth.guard';

// Every endpoint here is a staff/internal action — there's no customer-facing
// route in this controller. Once Orders exists, it calls InventoryService
// directly in-process (e.g. to reserve stock at checkout); a customer never
// hits these HTTP routes themselves.
@Controller()
@UseGuards(StaffAuthGuard)
export class InventoryController {
  constructor(private readonly inventoryService: InventoryService) {}

  @Get('inventory/:variantId')
  getInventory(@Param('variantId') variantId: string) {
    return this.inventoryService.getInventory(variantId);
  }

  @Patch('inventory/:variantId')
  updateSettings(@Param('variantId') variantId: string, @Body() dto: UpdateInventorySettingsDto) {
    return this.inventoryService.updateSettings(variantId, dto);
  }

  @Get('inventory/:variantId/transactions')
  getTransactionHistory(@Param('variantId') variantId: string) {
    return this.inventoryService.getTransactionHistory(variantId);
  }

  @Post('inventory/:variantId/receive')
  receiveStock(@Param('variantId') variantId: string, @Body() dto: ReceiveStockDto) {
    return this.inventoryService.receiveStock(variantId, dto);
  }

  @Post('inventory/:variantId/adjust')
  adjustStock(@Param('variantId') variantId: string, @Body() dto: AdjustStockDto) {
    return this.inventoryService.adjustStock(variantId, dto);
  }

  @Post('inventory/:variantId/write-off')
  writeOffStock(@Param('variantId') variantId: string, @Body() dto: WriteOffStockDto) {
    return this.inventoryService.writeOffStock(variantId, dto);
  }

  @Post('inventory/:variantId/return')
  returnStock(@Param('variantId') variantId: string, @Body() dto: ReturnStockDto) {
    return this.inventoryService.returnStock(variantId, dto);
  }

  @Post('inventory/:variantId/reservations')
  reserveStock(@Param('variantId') variantId: string, @Body() dto: CreateReservationDto) {
    return this.inventoryService.reserveStock(variantId, dto);
  }

  @Post('reservations/:reservationId/release')
  @HttpCode(HttpStatus.OK)
  releaseReservation(@Param('reservationId') reservationId: string) {
    return this.inventoryService.releaseReservation(reservationId);
  }

  @Post('reservations/:reservationId/consume')
  @HttpCode(HttpStatus.OK)
  consumeReservation(@Param('reservationId') reservationId: string) {
    return this.inventoryService.consumeReservation(reservationId);
  }

  /** Temporary manual trigger until a real scheduler exists — see inventory.service.ts. */
  @Post('inventory/cleanup-expired-reservations')
  @HttpCode(HttpStatus.OK)
  expireStaleReservations() {
    return this.inventoryService.expireStaleReservations();
  }
}
