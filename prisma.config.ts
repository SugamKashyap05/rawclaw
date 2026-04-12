import "dotenv/config";
import { defineConfig } from "prisma/config";

export default defineConfig({
  schema: "apps/api/prisma/schema.prisma",
  datasource: {
    url: process.env["DATABASE_URL"],
  },
});
