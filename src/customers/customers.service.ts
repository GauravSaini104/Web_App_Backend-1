import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../database/prisma.service';
import { handlePrismaError } from '../common/utils/prisma-error.util';
import { UpdateCustomerProfileDto } from './dto/update-customer-profile.dto';
import { CreateAddressDto } from './dto/create-address.dto';
import { UpdateAddressDto } from './dto/update-address.dto';

@Injectable()
export class CustomersService {
  constructor(private readonly prisma: PrismaService) {}

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
