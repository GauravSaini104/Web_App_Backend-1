import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../database/prisma.service';
import { handlePrismaError } from '../common/utils/prisma-error.util';
import { UpdateCustomerProfileDto } from './dto/update-customer-profile.dto';
import { CreateAddressDto } from './dto/create-address.dto';
import { UpdateAddressDto } from './dto/update-address.dto';
import { QueryCustomersDto } from './dto/query-customers.dto';

@Injectable()
export class CustomersService {
  constructor(private readonly prisma: PrismaService) {}

  async findAll(query: QueryCustomersDto) {
    const search = query.search?.trim();
    const where: Prisma.CustomerWhereInput = {
      ...(query.isPhoneVerified !== undefined && { isPhoneVerified: query.isPhoneVerified }),
      ...(search && {
        OR: [
          { id: { contains: search, mode: 'insensitive' as const } },
          { name: { contains: search, mode: 'insensitive' as const } },
          { phone: { contains: search } },
        ],
      }),
    };

    const page = query.page ?? 1;
    const limit = query.limit ?? 20;
    const sortBy = query.sortBy ?? 'createdAt';
    const sortOrder = query.sortOrder ?? 'desc';

    const [items, total] = await this.prisma.$transaction([
      this.prisma.customer.findMany({
        where,
        include: {
          addresses: {
            orderBy: [{ isDefault: 'desc' }, { createdAt: 'desc' }],
          },
          _count: {
            select: {
              orders: true,
              addresses: true,
            },
          },
        },
        orderBy: { [sortBy]: sortOrder },
        skip: (page - 1) * limit,
        take: limit,
      }),
      this.prisma.customer.count({ where }),
    ]);

    return {
      items,
      meta: {
        total,
        page,
        limit,
        totalPages: Math.ceil(total / limit) || 1,
      },
    };
  }

  async findOne(id: string) {
    const customer = await this.prisma.customer.findUnique({
      where: { id },
      include: {
        addresses: {
          orderBy: [{ isDefault: 'desc' }, { createdAt: 'desc' }],
        },
        orders: {
          orderBy: { createdAt: 'desc' },
          take: 10,
          include: {
            items: true,
          },
        },
        _count: {
          select: {
            orders: true,
            addresses: true,
            cartItems: true,
          },
        },
      },
    });

    if (!customer) {
      throw new NotFoundException('Customer not found');
    }

    return customer;
  }

  async remove(id: string) {
    const customer = await this.prisma.customer.findUnique({
      where: { id },
      include: {
        _count: {
          select: { orders: true },
        },
      },
    });

    if (!customer) {
      throw new NotFoundException('Customer not found');
    }

    if (customer._count.orders > 0) {
      throw new BadRequestException(
        `Cannot delete customer with ${customer._count.orders} existing order(s). Customer record must be preserved for order history.`,
      );
    }

    try {
      await this.prisma.customer.delete({ where: { id } });
      return { success: true, message: 'Customer deleted successfully' };
    } catch (error) {
      handlePrismaError(error, 'Customer');
    }
  }

  async getProfile(customerId: string) {
    const customer = await this.prisma.customer.findUnique({
      where: { id: customerId },
      include: {
        addresses: {
          orderBy: [{ isDefault: 'desc' }, { createdAt: 'desc' }],
        },
      },
    });

    if (!customer) {
      throw new NotFoundException('Customer not found');
    }

    return customer;
  }

  async updateProfile(customerId: string, dto: UpdateCustomerProfileDto) {
    try {
      return await this.prisma.customer.update({
        where: { id: customerId },
        data: { name: dto.name },
      });
    } catch (error) {
      handlePrismaError(error, 'Customer');
    }
  }

  listAddresses(customerId: string) {
    return this.prisma.address.findMany({
      where: { customerId },
      orderBy: [{ isDefault: 'desc' }, { createdAt: 'asc' }],
    });
  }

  async createAddress(customerId: string, dto: CreateAddressDto) {
    if (dto.isDefault) {
      await this.prisma.address.updateMany({ where: { customerId }, data: { isDefault: false } });
    }
    return this.prisma.address.create({
      data: {
        customerId,
        label: dto.label,
        line1: dto.line1,
        line2: dto.line2,
        city: dto.city,
        state: dto.state,
        pincode: dto.pincode,
        isDefault: dto.isDefault ?? false,
      },
    });
  }

  async updateAddress(customerId: string, addressId: string, dto: UpdateAddressDto) {
    await this.findAddressOrThrow(customerId, addressId);

    if (dto.isDefault) {
      await this.prisma.address.updateMany({ where: { customerId }, data: { isDefault: false } });
    }

    try {
      return await this.prisma.address.update({ where: { id: addressId }, data: dto });
    } catch (error) {
      handlePrismaError(error, 'Address');
    }
  }

  async removeAddress(customerId: string, addressId: string) {
    await this.findAddressOrThrow(customerId, addressId);
    try {
      await this.prisma.address.delete({ where: { id: addressId } });
    } catch (error) {
      handlePrismaError(error, 'Address');
    }
  }

  private async findAddressOrThrow(customerId: string, addressId: string) {
    const address = await this.prisma.address.findFirst({ where: { id: addressId, customerId } });
    if (!address) {
      throw new NotFoundException('Address not found');
    }
    return address;
  }
}
