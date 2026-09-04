import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../database/prisma.service';
import { slugify } from '../common/utils/slugify';
import { handlePrismaError } from '../common/utils/prisma-error.util';
import { CreateBrandDto } from './dto/create-brand.dto';
import { UpdateBrandDto } from './dto/update-brand.dto';

@Injectable()
export class BrandsService {
  constructor(private readonly prisma: PrismaService) {}

  async create(dto: CreateBrandDto) {
    try {
      return await this.prisma.brand.create({
        data: {
          name: dto.name,
          slug: dto.slug ?? slugify(dto.name),
          isActive: dto.isActive,
        },
      });
    } catch (error) {
      handlePrismaError(error, 'Brand');
    }
  }

  findAll() {
    return this.prisma.brand.findMany({ orderBy: { name: 'asc' } });
  }

  async findOne(id: string) {
    const brand = await this.prisma.brand.findUnique({ where: { id } });
    if (!brand) {
      throw new NotFoundException('Brand not found');
    }
    return brand;
  }

  async update(id: string, dto: UpdateBrandDto) {
    await this.findOne(id);
    try {
      return await this.prisma.brand.update({
        where: { id },
        data: {
          name: dto.name,
          slug: dto.slug,
          isActive: dto.isActive,
        },
      });
    } catch (error) {
      handlePrismaError(error, 'Brand');
    }
  }

  async remove(id: string) {
    await this.findOne(id);
    try {
      await this.prisma.brand.delete({ where: { id } });
    } catch (error) {
      handlePrismaError(error, 'Brand');
    }
  }
}
