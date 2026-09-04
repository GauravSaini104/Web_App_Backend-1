import { ConflictException, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';

/**
 * Translates internal database column names into the words a person
 * actually typed, so error messages make sense to non-technical staff
 * (e.g. "slug" is derived from "name" and should read as "name").
 */
const FIELD_LABELS: Record<string, string> = {
  slug: 'name',
  sku: 'SKU/barcode',
};

/**
 * Translates Prisma's low-level database error codes into the same
 * HttpException types the rest of the app already uses, so controllers
 * and the global exception filter don't need to know about Prisma at all.
 *
 * Common codes: P2002 = unique constraint violation, P2025 = record not
 * found, P2003 = foreign key constraint violation (e.g. deleting a
 * category that still has products).
 */
export function handlePrismaError(error: unknown, entityName: string): never {
  if (error instanceof Prisma.PrismaClientKnownRequestError) {
    if (error.code === 'P2002') {
      const target = (error.meta?.target as string[] | undefined) ?? [];
      const label = target.map((field) => FIELD_LABELS[field] ?? field).join(', ') || 'value';
      throw new ConflictException(`${entityName} with this ${label} already exists`);
    }
    if (error.code === 'P2025') {
      throw new NotFoundException(`${entityName} not found`);
    }
    if (error.code === 'P2003') {
      throw new ConflictException(
        `Cannot delete this ${entityName} because other records still reference it`,
      );
    }
  }
  throw error;
}
