import {
  BadRequestException,
  Body,
  Controller,
  NotFoundException,
  Post,
  Req,
  UploadedFile,
  UploadedFiles,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import { Request } from 'express';
import { AnyFilesInterceptor, FileInterceptor, FilesInterceptor } from '@nestjs/platform-express';
import { diskStorage } from 'multer';
import { randomUUID } from 'node:crypto';
import { existsSync, unlinkSync } from 'node:fs';
import { join } from 'node:path';
import { IsNotEmpty, IsString } from 'class-validator';
import { StaffAuthGuard } from '../auth/guards/staff-auth.guard';
import { PrismaService } from '../database/prisma.service';
import {
  ALLOWED_IMAGE_MIME_TYPES,
  getFullImageUrl,
  MAX_IMAGE_FILE_SIZE_BYTES,
  PRODUCT_MULTER_OPTIONS,
  PRODUCT_UPLOAD_DIR,
} from './uploads.config';

export class UploadProductImageDto {
  @IsString()
  @IsNotEmpty({ message: 'productId is required' })
  productId!: string;
}

@Controller('uploads')
@UseGuards(StaffAuthGuard)
export class UploadsController {
  constructor(private readonly prisma: PrismaService) {}

  @Post('product-image')
  @UseInterceptors(
    FileInterceptor('file', {
      storage: diskStorage({
        destination: PRODUCT_UPLOAD_DIR,
        filename: (_req, file, callback) => {
          callback(null, `${randomUUID()}${ALLOWED_IMAGE_MIME_TYPES[file.mimetype] ?? '.jpg'}`);
        },
      }),
      limits: { fileSize: MAX_IMAGE_FILE_SIZE_BYTES },
      fileFilter: (_req, file, callback) => {
        if (!ALLOWED_IMAGE_MIME_TYPES[file.mimetype]) {
          callback(new BadRequestException('Only JPEG, PNG, or WEBP images are allowed'), false);
          return;
        }
        callback(null, true);
      },
    }),
  )
  async uploadProductImage(
    @UploadedFile() file: Express.Multer.File,
    @Body() dto: UploadProductImageDto,
    @Req() req: Request,
  ) {
    if (!file) {
      throw new BadRequestException('No file was uploaded');
    }

    const cleanId = (dto.productId || '').trim().replace(/^["']|["']$/g, '');

    let product = await this.prisma.product.findUnique({
      where: { id: cleanId },
    });

    if (!product) {
      const variant = await this.prisma.productVariant.findUnique({
        where: { id: cleanId },
        include: { product: true },
      });
      if (variant) {
        product = variant.product;
      }
    }

    if (!product) {
      // Clean up newly uploaded file so disk doesn't keep orphaned file
      if (file.path && existsSync(file.path)) {
        try {
          unlinkSync(file.path);
        } catch {
          // ignore cleanup error
        }
      }
      throw new NotFoundException(`Product with ID "${dto.productId}" not found`);
    }

    // Clean up old local image file if it exists and being replaced
    if (product.imageUrl && product.imageUrl.includes('/uploads/products/')) {
      const oldFilename = product.imageUrl.split('/uploads/products/')[1];
      if (oldFilename) {
        const oldFilePath = join(PRODUCT_UPLOAD_DIR, oldFilename);
        if (existsSync(oldFilePath)) {
          try {
            unlinkSync(oldFilePath);
          } catch {
            // ignore cleanup error
          }
        }
      }
    }

    const fullUrl = getFullImageUrl(file.filename, req);
    const currentImages = product.images || [];
    const updatedImages = currentImages.includes(fullUrl)
      ? currentImages
      : [...currentImages, fullUrl];

    const updatedProduct = await this.prisma.product.update({
      where: { id: dto.productId },
      data: {
        imageUrl: fullUrl,
        images: updatedImages,
      },
      include: { brand: true, category: true, variants: true },
    });

    return {
      url: fullUrl,
      product: updatedProduct,
    };
  }

  @Post('product-images')
  @UseInterceptors(AnyFilesInterceptor(PRODUCT_MULTER_OPTIONS))
  async uploadProductImages(
    @UploadedFiles() files: Express.Multer.File[],
    @Body() dto: UploadProductImageDto,
    @Req() req: Request,
  ) {
    if (!files || files.length === 0) {
      throw new BadRequestException('No files were uploaded');
    }

    const cleanId = (dto.productId || '').trim().replace(/^["']|["']$/g, '');

    let product = await this.prisma.product.findUnique({
      where: { id: cleanId },
    });

    let matchedVariantId: string | null = null;
    if (!product) {
      const variant = await this.prisma.productVariant.findUnique({
        where: { id: cleanId },
        include: { product: true },
      });
      if (variant) {
        product = variant.product;
        matchedVariantId = variant.id;
      }
    }

    if (!product) {
      for (const file of files) {
        if (file.path && existsSync(file.path)) {
          try {
            unlinkSync(file.path);
          } catch {
            // ignore cleanup error
          }
        }
      }
      throw new NotFoundException(`Product with ID "${dto.productId}" not found`);
    }

    const newUrls = files.map((file) => getFullImageUrl(file.filename, req));
    const currentImages = product.images || [];
    const combinedImages = Array.from(new Set([...currentImages, ...newUrls]));

    if (matchedVariantId) {
      const variant = await this.prisma.productVariant.findUnique({ where: { id: matchedVariantId } });
      const currentVarImages = variant?.images || [];
      const combinedVarImages = Array.from(new Set([...currentVarImages, ...newUrls]));
      await this.prisma.productVariant.update({
        where: { id: matchedVariantId },
        data: {
          imageUrl: variant?.imageUrl || newUrls[0],
          images: combinedVarImages,
        },
      });
    }

    const updatedProduct = await this.prisma.product.update({
      where: { id: product.id },
      data: {
        imageUrl: product.imageUrl || newUrls[0],
        images: combinedImages,
      },
      include: { brand: true, category: true, variants: true },
    });

    return {
      urls: newUrls,
      product: updatedProduct,
    };
  }
}
