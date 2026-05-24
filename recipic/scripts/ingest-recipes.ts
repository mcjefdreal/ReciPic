/**
 * ingest-recipes.ts — One-time CSV ingestion + embedding generation.
 *
 * Streams recipes_data.csv, inserts into SQLite, generates embeddings via
 * OpenRouter embedding API, stores them in vec_recipes virtual table.
 *
 * Run: export $(grep -v '^#' .env | xargs) && npx tsx scripts/ingest-recipes.ts
 */

import { createReadStream } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import Database from "better-sqlite3";
import { parse } from "csv-parse";
import * as sqliteVec from "sqlite-vec";

// ── Config ──────────────────────────────────────────────────────────
const MAX_RECIPES = 100_000;
const BATCH_SIZE = 500;
const LOG_EVERY = 1_000;
const EMBEDDING_MODEL = "perplexity/pplx-embed-v1-4b"; // 2560-dim
const EMBEDDING_DIM = 2560;

// ── Paths ───────────────────────────────────────────────────────────
const __dirname = dirname(fileURLToPath(import.meta.url));
const CSV_PATH = resolve(__dirname, "..", "..", "recipes_data.csv");
const DB_PATH = resolve(__dirname, "..", "recipic.db");

// ── OpenRouter ──────────────────────────────────────────────────────
const OPENROUTER_URL = "https://openrouter.ai/api/v1/embeddings";
const OPENROUTER_API_KEY = process.env.OPENROUTER_API_KEY;
if (!OPENROUTER_API_KEY) {
  console.error("OPENROUTER_API_KEY not set in environment");
  process.exit(1);
}

async function embedTexts(texts: string[]): Promise<number[][]> {
  const truncated = texts.map((t) => t.slice(0, 8000));
  const resp = await fetch(OPENROUTER_URL, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${OPENROUTER_API_KEY}`,
      "Content-Type": "application/json",
      "HTTP-Referer": "https://recipic.app",
      "X-Title": "ReciPic",
    },
    body: JSON.stringify({
      model: EMBEDDING_MODEL,
      input: truncated,
    }),
  });

  if (!resp.ok) {
    const err = await resp.text();
    throw new Error(`Embedding API error ${resp.status}: ${err}`);
  }

  const data = await resp.json();
  const results = (data.data || []).sort((a: any, b: any) => a.index - b.index);
  return results.map((r: any) => r.embedding);
}

// ── Retry wrapper with exponential backoff ───────────────────────────
async function embedTextsWithRetry(
  texts: string[],
  maxRetries = 3,
): Promise<number[][]> {
  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      return await embedTexts(texts);
    } catch (err: any) {
      if (attempt === maxRetries) throw err;
      const delay = 1000 * Math.pow(2, attempt - 1); // 1s, 2s, 4s
      console.error(
        `    Embedding attempt ${attempt}/${maxRetries} failed: ${err.message}. Retrying in ${delay / 1000}s...`,
      );
      await new Promise((r) => setTimeout(r, delay));
    }
  }
  throw new Error("unreachable");
}

// ── DB setup ────────────────────────────────────────────────────────
const db = new Database(DB_PATH);
sqliteVec.load(db);

// Create vec0 virtual table for KNN search
db.exec(`
  DROP TABLE IF EXISTS vec_recipes;
  CREATE VIRTUAL TABLE vec_recipes USING vec0(
    metadata text,
    embedding float[${EMBEDDING_DIM}]
  )
`);

// ── Prepare statements ──────────────────────────────────────────────
const insertRecipe = db.prepare(`
  INSERT INTO recipes (name, description, ingredients, instructions, link, source, site, ner)
  VALUES (?, ?, ?, ?, ?, ?, ?, ?)
`);

const insertEmbedding = db.prepare(`
  INSERT INTO vec_recipes (metadata, embedding) VALUES (?, ?)
`);

const insertRecipeBatch = db.transaction((rows: any[]) => {
  for (const r of rows)
    insertRecipe.run(r.name, r.description, r.ingredients, r.instructions, r.link, r.source, r.site, r.ner);
});

const insertEmbeddingBatch = db.transaction(
  (rows: { recipe_id: number; embedding: number[] }[]) => {
    for (const r of rows)
      insertEmbedding.run(String(r.recipe_id), JSON.stringify(r.embedding));
  },
);

// ── Helpers ─────────────────────────────────────────────────────────
function safeJsonParse(raw: string): any {
  if (!raw || raw === "null" || raw === "undefined") return null;
  try {
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

function joinArray(arr: any[] | null): string {
  if (!arr || !Array.isArray(arr)) return "";
  return arr.join(", ");
}

// ── Main ────────────────────────────────────────────────────────────
async function main() {
  console.log(`Reading CSV: ${CSV_PATH}`);
  console.log(`Max recipes: ${MAX_RECIPES.toLocaleString()}`);
  console.log(`Embedding model: ${EMBEDDING_MODEL} (${EMBEDDING_DIM}d)`);
  console.log(`Batch size: ${BATCH_SIZE} (1 API call per batch, not per recipe)`);

  const stream = createReadStream(CSV_PATH, { encoding: "utf-8" });
  const parser = stream.pipe(parse({
    columns: true,
    skip_empty_lines: true,
    relax_quotes: true,
  }));

  let count = 0;
  let recipeBatch: any[] = [];
  let embeddingTexts: string[] = [];

  for await (const row of parser) {
    if (count >= MAX_RECIPES) break;

    const title = (row.title || "").trim();
    if (!title) continue;

    const ner = safeJsonParse(row.NER);
    const ingredients = safeJsonParse(row.ingredients);
    const directions = safeJsonParse(row.directions);

    const embeddingInput = `${title}: ${joinArray(ner)}`;

    const recipeRow = {
      name: title,
      description: null,
      ingredients: joinArray(ingredients),
      instructions: joinArray(directions),
      link: row.link || null,
      source: row.source || null,
      site: row.site || null,
      ner: JSON.stringify(ner),
    };

    recipeBatch.push(recipeRow);
    embeddingTexts.push(embeddingInput);
    count++;

    if (recipeBatch.length >= BATCH_SIZE) {
      insertRecipeBatch(recipeBatch);

      const lastId = db.prepare("SELECT last_insert_rowid() as id").get() as {
        id: number;
      };
      const startId = lastId.id - BATCH_SIZE + 1;

      console.log(
        `  Generating embeddings for batch ${Math.ceil(count / BATCH_SIZE)}...`,
      );

      try {
        const embeddings = await embedTextsWithRetry(embeddingTexts);
        const embeddingBatch = embeddings.map((emb, i) => ({
          recipe_id: startId + i,
          embedding: emb,
        }));
        insertEmbeddingBatch(embeddingBatch);
      } catch (err: any) {
        console.error(
          `  Batch ${Math.ceil(count / BATCH_SIZE)} embedding FAILED after retries: ${err.message}`,
        );
        console.error(
          `  Skipping embeddings for recipe IDs ${startId}–${startId + BATCH_SIZE - 1}. Recipes inserted but NOT vector-searchable. Re-run with a targeted fix script to backfill.`,
        );
        // NOTE: recipes already committed via insertRecipeBatch above.
        // Do NOT insert zero-vectors — that silently corrupts the index.
        // Missing embeddings are recoverable; poisoned vectors are not.
      }

      recipeBatch = [];
      embeddingTexts = [];

      if (count % LOG_EVERY === 0) {
        console.log(`  Ingested ${count.toLocaleString()} recipes...`);
      }
    }
  }

  // Flush remaining
  if (recipeBatch.length > 0) {
    insertRecipeBatch(recipeBatch);
    const lastId = db.prepare("SELECT last_insert_rowid() as id").get() as {
      id: number;
    };
    const startId = lastId.id - recipeBatch.length + 1;

    console.log(`  Generating embeddings for final batch...`);

    try {
      const embeddings = await embedTextsWithRetry(embeddingTexts);
      const embeddingBatch = embeddings.map((emb, i) => ({
        recipe_id: startId + i,
        embedding: emb,
      }));
      insertEmbeddingBatch(embeddingBatch);
    } catch (err: any) {
      console.error(
        `  Final batch embedding FAILED after retries: ${err.message}`,
      );
      console.error(
        `  Skipping embeddings for recipe IDs ${startId}–${startId + recipeBatch.length - 1}. Recipes inserted but NOT vector-searchable. Re-run with a targeted fix script to backfill.`,
      );
    }
  }

  // Stats
  const recipeCount = db.prepare("SELECT COUNT(*) as c FROM recipes").get() as {
    c: number;
  };
  const vecCount = db.prepare(
    "SELECT COUNT(*) as c FROM vec_recipes",
  ).get() as { c: number };

  console.log(`\nDone!`);
  console.log(`  Recipes in DB: ${recipeCount.c.toLocaleString()}`);
  console.log(`  Embeddings:    ${vecCount.c.toLocaleString()}`);

  db.close();
}

main().catch((err) => {
  console.error("Ingestion failed:", err);
  process.exit(1);
});
