import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import * as bcrypt from 'bcrypt';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../database/prisma.service';
import { handlePrismaError } from '../common/utils/prisma-error.util';
import { CreateStaffDto } from './dto/create-staff.dto';
import { UpdateStaffDto } from './dto/update-staff.dto';
import { QueryStaffDto } from './dto/query-staff.dto';

export const STAFF_SELECT = {
  id: true,
  username: true,
  displayName: true,
  isActive: true,
  createdAt: true,
  updatedAt: true,
} as const;

@Injectable()
export class StaffService {
  constructor(private readonly prisma: PrismaService) {}

  async create(dto: CreateStaffDto) {
    const passwordHash = await bcrypt.hash(dto.password, 10);
    try {
      return await this.prisma.staffUser.create({
        data: {
          username: dto.username.trim(),
          passwordHash,
          displayName: dto.displayName.trim(),
          isActive: dto.isActive ?? true,
        },
        select: STAFF_SELECT,
      });
    } catch (error) {
      handlePrismaError(error, 'Staff account');
    }
  }

  async findAll(query: QueryStaffDto) {
    const search = query.search?.trim();
    const where: Prisma.StaffUserWhereInput = {
      ...(query.isActive !== undefined && { isActive: query.isActive }),
      ...(search && {
        OR: [
          { username: { contains: search, mode: 'insensitive' as const } },
          { displayName: { contains: search, mode: 'insensitive' as const } },
        ],
      }),
    };

    const page = query.page ?? 1;
    const limit = query.limit ?? 20;
    const sortBy = query.sortBy ?? 'createdAt';
    const sortOrder = query.sortOrder ?? 'desc';

    const [items, total] = await this.prisma.$transaction([
      this.prisma.staffUser.findMany({
        where,
        select: STAFF_SELECT,
        orderBy: { [sortBy]: sortOrder },
        skip: (page - 1) * limit,
        take: limit,
      }),
      this.prisma.staffUser.count({ where }),
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
    const staff = await this.prisma.staffUser.findUnique({
      where: { id },
      select: STAFF_SELECT,
    });

    if (!staff) {
      throw new NotFoundException('Staff user not found');
    }

    return staff;
  }

  async update(id: string, dto: UpdateStaffDto) {
    await this.findOne(id);

    const data: Prisma.StaffUserUpdateInput = {
      ...(dto.username && { username: dto.username.trim() }),
      ...(dto.displayName && { displayName: dto.displayName.trim() }),
      ...(dto.isActive !== undefined && { isActive: dto.isActive }),
    };

    if (dto.password) {
      data.passwordHash = await bcrypt.hash(dto.password, 10);
    }

    try {
      return await this.prisma.staffUser.update({
        where: { id },
        data,
        select: STAFF_SELECT,
      });
    } catch (error) {
      handlePrismaError(error, 'Staff account');
    }
  }

  async remove(id: string, currentUserId?: string) {
    if (currentUserId && id === currentUserId) {
      throw new BadRequestException('You cannot delete your own staff account');
    }

    await this.findOne(id);

    const totalStaffCount = await this.prisma.staffUser.count();
    if (totalStaffCount <= 1) {
      throw new BadRequestException('Cannot delete the last remaining staff account');
    }

    try {
      await this.prisma.staffUser.delete({ where: { id } });
      return { success: true, message: 'Staff user deleted successfully' };
    } catch (error) {
      handlePrismaError(error, 'Staff account');
    }
  }
}
