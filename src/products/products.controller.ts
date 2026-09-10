import {
  BadRequestException,
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
  Res,
  UploadedFile,
  UploadedFiles,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import { Request, Response } from 'express';
import { AnyFilesInterceptor, FileInterceptor } from '@nestjs/platform-express';
import { memoryStorage } from 'multer';
import { ProductsService } from './products.service';
import { CreateProductDto } from './dto/create-product.dto';
import { UpdateProductDto } from './dto/update-product.dto';
import { QueryProductDto } from './dto/query-product.dto';
import { CreateProductVariantDto } from './dto/create-product-variant.dto';
import { UpdateProductVariantDto } from './dto/update-product-variant.dto';
import { BulkImportProductDto } from './dto/bulk-import-product.dto';
import { StaffAuthGuard } from '../auth/guards/staff-auth.guard';
import { PRODUCT_MULTER_OPTIONS } from '../uploads/uploads.config';
import { BodyKeyTrimmerInterceptor } from '../common/interceptors/body-key-trimmer.interceptor';

export const BULK_IMPORT_MULTER_OPTIONS = {
  storage: memoryStorage(),
  limits: { fileSize: 10 * 1024 * 1024 }, // 10MB spreadsheet limit
  fileFilter: (_req: any, file: any, callback: any) => {
    const allowedExtensions = /\.(xlsx|xls|csv|tsv)$/i;
    if (!file.originalname.match(allowedExtensions)) {
      callback(
        new BadRequestException('Only Excel (.xlsx, .xls) or CSV (.csv) files are allowed for bulk import'),
        false,
      );
      return;
    }
    callback(null, true);
  },
};

@Controller('products')
@UseInterceptors(BodyKeyTrimmerInterceptor)
export class ProductsController {
  constructor(private readonly productsService: ProductsService) {}

  @Get()
  findAll(@Query() query: QueryProductDto) {
    return this.productsService.findAll(query);
  }

  @Get('bulk-import/template')
  downloadBulkImportTemplate(
    @Query('format') format: 'xlsx' | 'csv' = 'xlsx',
    @Res() res: Response,
  ) {
    const template = this.productsService.generateBulkImportTemplate(format);
    res.setHeader('Content-Type', template.mimeType);
    res.setHeader('Content-Disposition', `attachment; filename="${template.filename}"`);
    return res.send(template.buffer);
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

  @Post('bulk-import')
  @UseGuards(StaffAuthGuard)
  @UseInterceptors(FileInterceptor('file', BULK_IMPORT_MULTER_OPTIONS))
  bulkImport(
    @Body() dto: BulkImportProductDto,
    @UploadedFile() file?: Express.Multer.File,
    @Req() req?: Request,
  ) {
    const staffId = (req as any)?.user?.id;
    return this.productsService.bulkImport(
      dto.categoryId,
      dto.brandId,
      file,
      dto.products,
      staffId,
    );
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
