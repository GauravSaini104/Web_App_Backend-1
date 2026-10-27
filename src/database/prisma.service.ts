import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { PrismaClient } from '@prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';
import { Pool } from 'pg';

/**
 * Wraps Prisma's generated client as a Nest provider so it can be injected
 * into any service, and connects/disconnects in step with the app's
 * lifecycle instead of leaking connections.
 *
 * Uses the `pg` driver adapter instead of Prisma's default Rust query
 * engine: some sandboxed hosting environments (observed on Hostinger's
 * managed Node app hosting) crash that engine with a Rust-level
 * "PANIC: timer has gone away" on startup. The driver adapter runs queries
 * through the plain JS `pg` client instead, sidestepping that entirely.
 */
@Injectable()
export class PrismaService extends PrismaClient implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(PrismaService.name);

  constructor() {
    const pool = new Pool({
      connectionString: process.env.DATABASE_URL,
      max: 10,
      idleTimeoutMillis: 30000,
      connectionTimeoutMillis: 10000,
      keepAlive: true,
      keepAliveInitialDelayMillis: 10000,
    });
    pool.on('error', (err) => {
      this.logger.warn(`PostgreSQL idle client connection reset (will reconnect): ${err.message}`);
    });
    super({ adapter: new PrismaPg(pool) });
  }

  /**
   * Deliberately not awaited: Nest holds up app.listen() until every
   * module's onModuleInit() resolves, and some hosts (Hostinger's Node app
   * hosting included) fail the deployment if the app doesn't start
   * listening within a few seconds. A slow/cold-starting database
   * connection would otherwise block startup entirely. Prisma connects
   * lazily on first query regardless, so this just logs the outcome
   * without gating readiness on it.
   */
  onModuleInit() {
    this.$connect()
      .then(async () => {
        this.logger.log('Connected to PostgreSQL via Prisma');
        await this.autoMigrate();
      })
      .catch((error: Error) => this.logger.error('Failed to connect to PostgreSQL', error.stack));
  }

  /**
   * Automatically applies any pending Prisma migrations on startup.
   * This guarantees that whenever new columns, tables, or indexes are
   * added to schema.prisma, PostgreSQL is immediately updated without
   * requiring manual terminal intervention or causing runtime "column does not exist" errors.
   */
  private async autoMigrate() {
    if (process.env.NODE_ENV === 'test' || process.env.AUTO_MIGRATE === 'false') {
      return;
    }

    try {
      const { exec } = await import('node:child_process');
      const { promisify } = await import('node:util');
      const execAsync = promisify(exec);

      const { stdout } = await execAsync('npx prisma migrate deploy');
      if (stdout && stdout.toLowerCase().includes('applying migration')) {
        this.logger.log(`Database auto-migration applied successfully:\n${stdout.trim()}`);
      }
    } catch (err: any) {
      this.logger.warn(`Database auto-migration check: ${err?.message ?? err}`);
    }
  }

  async onModuleDestroy() {
    await this.$disconnect();
  }
}
