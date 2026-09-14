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
  Query,
  Req,
  UploadedFiles,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import { Request } from 'express';
import { AnyFilesInterceptor } from '@nestjs/platform-express';
import { CategoriesService } from './categories.service';
import { ProductsService } from '../products/products.service';
import { QueryProductDto } from '../products/dto/query-product.dto';
import { CreateCategoryDto } from './dto/create-category.dto';
import { UpdateCategoryDto } from './dto/update-category.dto';
import { StaffAuthGuard } from '../auth/guards/staff-auth.guard';
import { CATEGORY_MULTER_OPTIONS } from '../uploads/uploads.config';

@Controller('categories')
export class CategoriesController {
  constructor(
    private readonly categoriesService: CategoriesService,
    private readonly productsService: ProductsService,
  ) { }

  @Get()
  findAll() {
    return this.categoriesService.findAll();
  }

  @Get(':id')
  findOne(@Param('id') id: string) {
    return this.categoriesService.findOne(id);
  }

  @Get(':id/products')
  findProducts(
    @Param('id') id: string,
    @Query() query: QueryProductDto,
  ) {
    return this.productsService.findByCategory(id, query);
  }

  // Managing the catalog is a staff-only action.
  @Post()
  @UseGuards(StaffAuthGuard)
  @UseInterceptors(AnyFilesInterceptor(CATEGORY_MULTER_OPTIONS))
  create(
    @Body() dto: CreateCategoryDto,
    @UploadedFiles() files?: Express.Multer.File[],
    @Req() req?: Request,
  ) {
    return this.categoriesService.create(dto, files, req);
  }

  @Patch(':id')
  @UseGuards(StaffAuthGuard)
  @UseInterceptors(AnyFilesInterceptor(CATEGORY_MULTER_OPTIONS))
  update(
    @Param('id') id: string,
    @Body() dto: UpdateCategoryDto,
    @UploadedFiles() files?: Express.Multer.File[],
    @Req() req?: Request,
  ) {
    return this.categoriesService.update(id, dto, files, req);
  }

  @Delete(':id')
  @UseGuards(StaffAuthGuard)
  @HttpCode(HttpStatus.NO_CONTENT)
  remove(@Param('id') id: string) {
    return this.categoriesService.remove(id);
  }
}

