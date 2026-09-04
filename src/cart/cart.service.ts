import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../database/prisma.service';
import { InventoryService } from '../inventory/inventory.service';
import { AddCartItemDto } from './dto/add-cart-item.dto';
import { UpdateCartItemDto } from './dto/update-cart-item.dto';
import { MAX_CART_ITEM_QUANTITY } from './cart.constants';

const VARIANT_WITH_PRODUCT = { product: { include: { category: true } } } as const;

@Injectable()
export class CartService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly inventoryService: InventoryService,
  ) {}

  /**
   * Live-computed on every read: prices, stock, and availability always
   * reflect right now, never whatever was true when the item was added.
   */
  async getCart(customerId: string) {
    const items = await this.prisma.cartItem.findMany({
      where: { customerId },
      include: { variant: { include: VARIANT_WITH_PRODUCT } },
      orderBy: { createdAt: 'asc' },
    });

    const enrichedItems = await Promise.all(
      items.map(async (item) => {
        const inventory = await this.inventoryService
          .getInventory(item.variantId)
          .catch(() => null);
        const sellingPrice = Number(item.variant.sellingPrice);
        const isAvailable =
          item.variant.product.isActive &&
          item.variant.isActive &&
          (inventory?.isSellable ?? false);

        return {
          id: item.id,
          variantId: item.variantId,
          quantity: item.quantity,
          product: {
            id: item.variant.product.id,
            name: item.variant.product.name,
            imageUrl: item.variant.product.imageUrl,
            category: item.variant.product.category
              ? { slug: item.variant.product.category.slug, name: item.variant.product.category.name }
              : null,
          },
          variant: {
            sku: item.variant.sku,
            unit: item.variant.unit,
            weight: item.variant.weight,
            sellingPrice,
            mrp: Number(item.variant.mrp),
          },
          lineTotal: Number((sellingPrice * item.quantity).toFixed(2)),
          availableStock: inventory?.available ?? 0,
          isAvailable,
        };
      }),
    );

    const grandTotal = Number(
      enrichedItems.reduce((sum, item) => sum + item.lineTotal, 0).toFixed(2),
    );

    return { items: enrichedItems, itemCount: enrichedItems.length, grandTotal };
  }

  /**
   * Adding the same variant twice increases its quantity (an "Add to
   * cart" click), capped at the sane maximum rather than growing forever.
   * No stock check here at all — checkout is the only place that matters.
   */
  async addItem(customerId: string, dto: AddCartItemDto) {
    const variant = await this.prisma.productVariant.findUnique({
      where: { id: dto.variantId },
      include: VARIANT_WITH_PRODUCT,
    });
    if (!variant) {
      throw new NotFoundException('Product variant not found');
    }
    if (!variant.isActive || !variant.product.isActive) {
      throw new BadRequestException('This item is no longer available');
    }

    const existing = await this.prisma.cartItem.findUnique({
      where: { customerId_variantId: { customerId, variantId: dto.variantId } },
    });
    const newQuantity = Math.min((existing?.quantity ?? 0) + dto.quantity, MAX_CART_ITEM_QUANTITY);

    return this.prisma.cartItem.upsert({
      where: { customerId_variantId: { customerId, variantId: dto.variantId } },
      create: { customerId, variantId: dto.variantId, quantity: dto.quantity },
      update: { quantity: newQuantity },
    });
  }

  /** Sets the exact quantity for one line (a stepper/input), not a delta. */
  async updateItem(customerId: string, itemId: string, dto: UpdateCartItemDto) {
    await this.findItemOrThrow(customerId, itemId);
    return this.prisma.cartItem.update({ where: { id: itemId }, data: { quantity: dto.quantity } });
  }

  async removeItem(customerId: string, itemId: string) {
    await this.findItemOrThrow(customerId, itemId);
    await this.prisma.cartItem.delete({ where: { id: itemId } });
  }

  async clearCart(customerId: string) {
    await this.prisma.cartItem.deleteMany({ where: { customerId } });
  }

  private async findItemOrThrow(customerId: string, itemId: string) {
    const item = await this.prisma.cartItem.findFirst({ where: { id: itemId, customerId } });
    if (!item) {
      throw new NotFoundException('Cart item not found');
    }
    return item;
  }
}
