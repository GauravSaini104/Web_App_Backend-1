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
import { ProductsService } from './products.service';
import { CreateProductDto } from './dto/create-product.dto';
import { UpdateProductDto } from './dto/update-product.dto';
import { QueryProductDto } from './dto/query-product.dto';
import { CreateProductVariantDto } from './dto/create-product-variant.dto';
import { UpdateProductVariantDto } from './dto/update-product-variant.dto';
import { StaffAuthGuard } from '../auth/guards/staff-auth.guard';
import { PRODUCT_MULTER_OPTIONS } from '../uploads/uploads.config';
import { BodyKeyTrimmerInterceptor } from '../common/interceptors/body-key-trimmer.interceptor';

@Controller('products')
@UseInterceptors(BodyKeyTrimmerInterceptor)
export class ProductsController {
  constructor(private readonly productsService: ProductsService) {}

  @Get()
  findAll(@Query() query: QueryProductDto) {
    return this.productsService.findAll(query);
  }

  // Must come before ':id' — otherwise "barcode" would be matched as an id.
  @Get('barcode/:sku')
  findBySku(@Param('sku') sku: string) {
    return this.productsService.findBySku(sku);
  }

  @Get(':id')
  findOne(@Param('id') id: string) {
    return this.productsService.findOne(id);
  }

  @Post()
  @UseGuards(StaffAuthGuard)
  @UseInterceptors(AnyFilesInterceptor(PRODUCT_MULTER_OPTIONS))
  create(
    @Body() dto: CreateProductDto,
    @UploadedFiles() files?: Express.Multer.File[],
    @Req() req?: Request,
  ) {
    return this.productsService.create(dto, files, req);
  }

  @Patch(':id')
  @UseGuards(StaffAuthGuard)
  @UseInterceptors(AnyFilesInterceptor(PRODUCT_MULTER_OPTIONS))
  update(
    @Param('id') id: string,
    @Body() dto: UpdateProductDto,
    @UploadedFiles() files?: Express.Multer.File[],
    @Req() req?: Request,
  ) {
    return this.productsService.update(id, dto, files, req);
  }

  @Delete(':id')
  @UseGuards(StaffAuthGuard)
  @HttpCode(HttpStatus.NO_CONTENT)
  remove(@Param('id') id: string) {
    return this.productsService.remove(id);
  }

  @Post(':id/variants')
  @UseGuards(StaffAuthGuard)
  @UseInterceptors(AnyFilesInterceptor(PRODUCT_MULTER_OPTIONS))
  addVariant(
    @Param('id') id: string,
    @Body() dto: CreateProductVariantDto,
    @UploadedFiles() files?: Express.Multer.File[],
    @Req() req?: Request,
  ) {
    return this.productsService.addVariant(id, dto, files, req);
  }

  @Patch(':id/variants/:variantId')
  @UseGuards(StaffAuthGuard)
  @UseInterceptors(AnyFilesInterceptor(PRODUCT_MULTER_OPTIONS))
  updateVariant(
    @Param('id') id: string,
    @Param('variantId') variantId: string,
    @Body() dto: UpdateProductVariantDto,
    @UploadedFiles() files?: Express.Multer.File[],
    @Req() req?: Request,
  ) {
    return this.productsService.updateVariant(id, variantId, dto, files, req);
  }

  @Delete(':id/variants/:variantId')
  @UseGuards(StaffAuthGuard)
  @HttpCode(HttpStatus.NO_CONTENT)
  removeVariant(@Param('id') id: string, @Param('variantId') variantId: string) {
    return this.productsService.removeVariant(id, variantId);
  }
}
