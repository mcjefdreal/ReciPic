import assert from "node:assert/strict";
import { env } from "node:process";

import { defineConfig } from "drizzle-kit";

assert(env.DATABASE_URL, "DATABASE_URL is not set");

export default defineConfig({
    schema: "./src/lib/db/schema.ts",
    out: "./drizzle",
    dialect: "sqlite",
    dbCredentials: { url: env.DATABASE_URL },
});
