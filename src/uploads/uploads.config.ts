import { BadRequestException } from '@nestjs/common';
import { diskStorage } from 'multer';
import { randomUUID } from 'node:crypto';
import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { Request } from 'express';

export const ALLOWED_IMAGE_MIME_TYPES: Record<string, string> = {
  'image/jpeg': '.jpg',
  'image/png': '.png',
  'image/webp': '.webp',
};

export const MAX_IMAGE_FILE_SIZE_BYTES = 5 * 1024 * 1024; // 5MB
export const PRODUCT_UPLOAD_DIR = join(process.cwd(), 'uploads', 'products');

// Ensure directory exists on startup
mkdirSync(PRODUCT_UPLOAD_DIR, { recursive: true });

/**
 * Returns the configured base URL from .env (e.g. `http://72.62.228.103:3000`),
 * with fallbacks for request host or localhost if unset.
 */
export function getBaseUrl(req?: Request): string {
  if (process.env.BASE_URL) {
    return process.env.BASE_URL.trim().replace(/\/+$/, '');
  }
  if (req) {
    const host = req.get('host') || 'localhost:3000';
    const isLocalhost = host.includes('localhost') || host.includes('127.0.0.1');
    const protocol = isLocalhost
      ? 'http'
      : (req.headers['x-forwarded-proto'] as string) || req.protocol || 'https';
    return `${protocol}://${host}`;
  }
  return 'http://localhost:3000';
}

/**
 * Builds the absolute publicly accessible URL for an uploaded file using BASE_URL from .env
 */
export function getFullImageUrl(filename: string, req?: Request): string {
  const baseUrl = getBaseUrl(req);
  return `${baseUrl}/uploads/products/${filename}`;
}

export const PRODUCT_MULTER_OPTIONS = {
  storage: diskStorage({
    destination: PRODUCT_UPLOAD_DIR,
    filename: (_req, file, callback) => {
      callback(null, `${randomUUID()}${ALLOWED_IMAGE_MIME_TYPES[file.mimetype] ?? '.jpg'}`);
    },
  }),
  limits: { fileSize: MAX_IMAGE_FILE_SIZE_BYTES },
  fileFilter: (_req: any, file: any, callback: any) => {
    if (!ALLOWED_IMAGE_MIME_TYPES[file.mimetype]) {
      callback(new BadRequestException('Only JPEG, PNG, or WEBP images are allowed'), false);
      return;
    }
    callback(null, true);
  },
};
