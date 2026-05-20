import { drizzle } from "drizzle-orm/better-sqlite3";
import Database from "better-sqlite3";
import { DATABASE_URL } from "$env/static/private";
import * as schema from "./schema";
import * as sqliteVec from "sqlite-vec";

// Path to your SQLite file
const sqlite = new Database(DATABASE_URL);

// Load sqlite-vec extension for vector similarity search
sqlite.loadExtension(sqliteVec.getLoadablePath());

// Ensure vec_recipes virtual table exists (2560-dim for pplx-embed-v1-4b)
sqlite.exec(`
  CREATE VIRTUAL TABLE IF NOT EXISTS vec_recipes USING vec0(
    metadata text,
    embedding float[2560]
  )
`);

// Export the Drizzle client with schema for relational queries
export const db = drizzle(sqlite, { schema });

// Export raw sqlite for extension-specific operations
export { sqlite };
