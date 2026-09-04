import {
  BadRequestException,
  Body,
  Controller,
  NotFoundException,
  Post,
  Req,
  UploadedFile,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import { Request } from 'express';
import { FileInterceptor } from '@nestjs/platform-express';
import { diskStorage } from 'multer';
import { randomUUID } from 'node:crypto';
import { existsSync, mkdirSync, unlinkSync } from 'node:fs';
import { join } from 'node:path';
import { IsNotEmpty, IsString } from 'class-validator';
import { StaffAuthGuard } from '../auth/guards/staff-auth.guard';
import { PrismaService } from '../database/prisma.service';

export class UploadProductImageDto {
  @IsString()
  @IsNotEmpty({ message: 'productId is required' })
  productId!: string;
}

// Keyed explicitly rather than derived from the client-supplied original
// filename: a client's declared mimetype (also client-supplied, and not
// re-verified against actual file content) is at least gated by
// fileFilter below, whereas the original filename's extension is not
// checked against anything and was previously used verbatim — meaning a
// file could be saved and then statically served as ".html"/".svg" with
// a matching dangerous Content-Type despite "passing" the image check.
// Pinning the saved extension to this fixed, safe set closes that off.
const ALLOWED_MIME_TYPES: Record<string, string> = {
  'image/jpeg': '.jpg',
  'image/png': '.png',
  'image/webp': '.webp',
};
const MAX_FILE_SIZE_BYTES = 5 * 1024 * 1024; // 5MB — plenty for a product photo, keeps disk usage sane.
const UPLOAD_DIR = join(process.cwd(), 'uploads', 'products');

// multer's diskStorage does not create missing directories itself — this
// must exist before the first upload, including on a fresh deployment
// where nothing has ever been uploaded yet.
mkdirSync(UPLOAD_DIR, { recursive: true });

@Controller('uploads')
@UseGuards(StaffAuthGuard)
export class UploadsController {
  constructor(private readonly prisma: PrismaService) { }

  @Post('product-image')
  @UseInterceptors(
    FileInterceptor('file', {
      storage: diskStorage({
        destination: UPLOAD_DIR,
        // A random filename avoids collisions; the extension comes only
        // from the fixed allow-list above, never from anything the
        // client sent (path traversal, weird chars, spoofed extension).
        filename: (_req, file, callback) => {
          callback(null, `${randomUUID()}${ALLOWED_MIME_TYPES[file.mimetype] ?? '.jpg'}`);
        },
      }),
      limits: { fileSize: MAX_FILE_SIZE_BYTES },
      fileFilter: (_req, file, callback) => {
        if (!ALLOWED_MIME_TYPES[file.mimetype]) {
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

    const product = await this.prisma.product.findUnique({
      where: { id: dto.productId },
    });

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

    // Clean up old local image file if it exists
    if (product.imageUrl && product.imageUrl.includes('/uploads/products/')) {
      const oldFilename = product.imageUrl.split('/uploads/products/')[1];
      if (oldFilename) {
        const oldFilePath = join(UPLOAD_DIR, oldFilename);
        if (existsSync(oldFilePath)) {
          try {
            unlinkSync(oldFilePath);
          } catch {
            // ignore cleanup error
          }
        }
      }
    }

    const host = req.get('host') || 'localhost:3000';
    const isLocalhost = host.includes('localhost') || host.includes('127.0.0.1');
    const protocol = isLocalhost
      ? 'http'
      : (req.headers['x-forwarded-proto'] as string) || req.protocol || 'https';
    const fullUrl = `${protocol}://${host}/uploads/products/${file.filename}`;

    const updatedProduct = await this.prisma.product.update({
      where: { id: dto.productId },
      data: { imageUrl: fullUrl },
      include: { brand: true, category: true, variants: true },
    });

    return {
      url: fullUrl,
      product: updatedProduct,
    };   
  }
}
