import { Injectable, OnModuleInit, OnModuleDestroy } from '@nestjs/common';
import { PrismaClient } from '@prisma/client';
import { PrismaBetterSqlite3 } from '@prisma/adapter-better-sqlite3';

@Injectable()
export class PrismaService extends PrismaClient implements OnModuleInit, OnModuleDestroy {
  constructor() {
    // Resolve database path from environment
    const dbUrl = process.env.DATABASE_URL || 'file:./prisma/dev.db';
    const dbPath = dbUrl.startsWith('file:') ? dbUrl.replace('file:', '') : dbUrl;

    const adapter = new PrismaBetterSqlite3({
      url: dbPath,
    });
    super({ adapter });
  }

  async onModuleInit() {
    try {
      await this.$connect();
    } catch (e) {
      console.error('Prisma connection error:', e);
    }
  }

  async onModuleDestroy() {
    await this.$disconnect();
  }
}
