import { Injectable, OnModuleInit, OnModuleDestroy } from '@nestjs/common';
import { PrismaClient } from '@prisma/client';
import { PrismaBetterSqlite3 } from '@prisma/adapter-better-sqlite3';
import { existsSync } from 'node:fs';
import * as path from 'node:path';

@Injectable()
export class PrismaService extends PrismaClient implements OnModuleInit, OnModuleDestroy {
  constructor() {
    // Resolve database path from environment
    const dbUrl = process.env.DATABASE_URL || 'file:./prisma/dev.db';
    let dbPath = dbUrl.startsWith('file:') ? dbUrl.replace('file:', '') : dbUrl;
    if (!path.isAbsolute(dbPath)) {
      const cwdCandidate = path.resolve(process.cwd(), dbPath);
      const apiCandidate = path.resolve(process.cwd(), 'apps', 'api', 'prisma', 'dev.db');
      const localApiCandidate = path.resolve(process.cwd(), 'prisma', 'dev.db');
      if (existsSync(cwdCandidate)) {
        dbPath = cwdCandidate;
      } else if (existsSync(localApiCandidate)) {
        dbPath = localApiCandidate;
      } else if (existsSync(apiCandidate)) {
        dbPath = apiCandidate;
      } else {
        dbPath = cwdCandidate;
      }
    }

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
