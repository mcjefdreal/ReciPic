import { drizzle } from "drizzle-orm/better-sqlite3";
import Database from "better-sqlite3";
import { DATABASE_URL } from "$env/static/private";
import * as schema from "./schema";

// Path to your SQLite file
const sqlite = new Database(DATABASE_URL);

// Export the Drizzle client with schema for relational queries
export const db = drizzle(sqlite, { schema });
