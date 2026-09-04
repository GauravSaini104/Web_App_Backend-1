import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../database/prisma.service';
import { slugify } from '../common/utils/slugify';
import { handlePrismaError } from '../common/utils/prisma-error.util';
import { CreateCategoryDto } from './dto/create-category.dto';
import { UpdateCategoryDto } from './dto/update-category.dto';

@Injectable()
export class CategoriesService {
  constructor(private readonly prisma: PrismaService) {}

  async create(dto: CreateCategoryDto) {
    try {
      return await this.prisma.category.create({
        data: {
          name: dto.name,
          slug: dto.slug ?? slugify(dto.name),
          description: dto.description,
          isActive: dto.isActive,    
        },
      });
    } catch (error) {
      handlePrismaError(error, 'Category');
    }
  }

  findAll() {
    return this.prisma.category.findMany({ orderBy: { name: 'asc' } });
  }

  async findOne(id: string) {
    const category = await this.prisma.category.findUnique({ where: { id } });
    if (!category) {
      throw new NotFoundException('Category not found');
    }
    return category;
  }

  async update(id: string, dto: UpdateCategoryDto) {
    await this.findOne(id);
    try {
      return await this.prisma.category.update({
        where: { id },
        data: {
          name: dto.name,
          slug: dto.slug,
          description: dto.description,
          isActive: dto.isActive,
        },
      });
    } catch (error) {
      handlePrismaError(error, 'Category');
    }
  }

  async remove(id: string) {
    await this.findOne(id);
    try {
      await this.prisma.category.delete({ where: { id } });
    } catch (error) {
      handlePrismaError(error, 'Category');
    }
  }
}
