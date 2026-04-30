import "dotenv/config";
import { defineConfig } from "prisma/config";
import { existsSync } from "node:fs";
import * as path from "node:path";

const rawUrl = process.env["DATABASE_URL"] || "file:./prisma/dev.db";

function resolveDatabaseUrl(url: string): string {
  if (!url.startsWith("file:./prisma/dev.db")) {
    return url;
  }
  const rootCandidate = path.resolve(process.cwd(), "prisma", "dev.db");
  const apiCandidate = path.resolve(process.cwd(), "apps", "api", "prisma", "dev.db");
  if (process.cwd().includes(`${path.sep}apps${path.sep}api`) || process.cwd().endsWith(`${path.sep}apps${path.sep}api`)) {
    return "file:./prisma/dev.db";
  }
  if (existsSync(rootCandidate)) {
    return "file:./prisma/dev.db";
  }
  if (existsSync(apiCandidate)) {
    return "file:./apps/api/prisma/dev.db";
  }
  return "file:./apps/api/prisma/dev.db";
}

export default defineConfig({
  schema: "apps/api/prisma/schema.prisma",
  datasource: {
    url: resolveDatabaseUrl(rawUrl),
  },
});
