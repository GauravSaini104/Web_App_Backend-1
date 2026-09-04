import { Global, Module } from '@nestjs/common';
import { PrismaService } from './prisma.service';

/**
 * @Global() means every other module in the app can inject PrismaService
 * without importing PrismaModule themselves — there is only ever one
 * database connection pool for the whole app.
 */
@Global()
@Module({
  providers: [PrismaService],
  exports: [PrismaService],
})
export class PrismaModule {}
