import { Injectable, NotFoundException } from '@nestjs/common';
import { Request } from 'express';
import { PrismaService } from '../database/prisma.service';
import { slugify } from '../common/utils/slugify';
import { handlePrismaError } from '../common/utils/prisma-error.util';
import { CreateCategoryDto } from './dto/create-category.dto';
import { UpdateCategoryDto } from './dto/update-category.dto';
import { getCategoryFullImageUrl } from '../uploads/uploads.config';

@Injectable()
export class CategoriesService {
  constructor(private readonly prisma: PrismaService) { }

  async create(dto: CreateCategoryDto, files?: Express.Multer.File[], req?: Request) {
    if (files && files.length > 0) {
      dto.imageUrl = getCategoryFullImageUrl(files[0].filename, req);
    }

    try {
      return await this.prisma.category.create({
        data: {
          name: dto.name,
          slug: dto.slug ?? slugify(dto.name),
          description: dto.description,
          imageUrl: dto.imageUrl,
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

  async update(id: string, dto: UpdateCategoryDto, files?: Express.Multer.File[], req?: Request) {
    await this.findOne(id);
    if (files && files.length > 0) {
      dto.imageUrl = getCategoryFullImageUrl(files[0].filename, req);
    }

    try {
      return await this.prisma.category.update({
        where: { id },
        data: {
          name: dto.name,
          slug: dto.slug,
          description: dto.description,
          imageUrl: dto.imageUrl,
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
