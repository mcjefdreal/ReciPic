import { json } from '@sveltejs/kit';
import { db, sqlite } from '$lib/db';
import { pantry } from '$lib/db/schema';
import { OPENROUTER_API_KEY } from '$env/static/private';

const OPENROUTER_URL = 'https://openrouter.ai/api/v1';
const EMBEDDING_MODEL = 'perplexity/pplx-embed-v1-4b'; // 2560-dim
const CHAT_MODEL = 'qwen/qwen3.6-flash';
const VECTOR_TOP_K = 20;
const RAG_MAX_RESULTS = 5;
const EMBED_TIMEOUT_MS = 25_000;
const RERANK_TIMEOUT_MS = 20_000;

// ── Embedding cache ──────────────────────────────────────────────────
// Key: queryText (deterministic from pantry). Self-invalidating — pantry
// change → queryText change → cache miss. Persists for process lifetime.
const embeddingCache = new Map<string, Float32Array>();

// ── JSON extraction helper ──────────────────────────────────────────
function extractJSON(content: string): string {
  const start = content.indexOf('```json');
  if (start !== -1) {
    const block = content.slice(start + 7);
    const end = block.indexOf('```');
    if (end !== -1) return block.slice(0, end).trim();
  }
  const plain = content.indexOf('```');
  if (plain !== -1) {
    const block = content.slice(plain + 3);
    const end = block.indexOf('```');
    if (end !== -1) return block.slice(0, end).trim();
  }
  return content.trim();
}

// ── Generate embedding via OpenRouter (cached + timeout) ────────────
async function embedText(text: string): Promise<Float32Array> {
  const cached = embeddingCache.get(text);
  if (cached) return cached;

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), EMBED_TIMEOUT_MS);

  const resp = await fetch(`${OPENROUTER_URL}/embeddings`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${OPENROUTER_API_KEY}`,
      'Content-Type': 'application/json',
      'HTTP-Referer': 'https://recipic.app',
      'X-Title': 'ReciPic',
    },
    body: JSON.stringify({
      model: EMBEDDING_MODEL,
      input: text.slice(0, 8000),
    }),
    signal: controller.signal,
  }).finally(() => clearTimeout(timeout));

  if (!resp.ok) {
    const err = await resp.text();
    throw new Error(`Embedding API error ${resp.status}: ${err}`);
  }

  const data = await resp.json();
  const embedding = data.data?.[0]?.embedding;
  if (!embedding) throw new Error('No embedding returned from API');

  const vec = new Float32Array(embedding);
  embeddingCache.set(text, vec);
  return vec;
}

// ── Vector similarity search ────────────────────────────────────────
function vectorSearch(embedding: Float32Array, limit: number) {
  const embeddingJson = JSON.stringify(Array.from(embedding));
  return sqlite
    .prepare(`
    SELECT rowid, metadata, distance FROM vec_recipes
    WHERE embedding MATCH ?
    ORDER BY distance
    LIMIT ?
  `)
    .all(embeddingJson, limit) as { rowid: number; metadata: string; distance: number }[];
}

// ── RAG reranking via OpenRouter ────────────────────────────────────
async function rerankWithLLM(
  pantryNames: string[],
  candidates: {
    id: number;
    name: string;
    ner: string | null;
    ingredients: string | null;
  }[],
): Promise<Array<{ id: number; name: string; score: number; reasoning: string }>> {
  const candidateMap = new Map(candidates.map((c) => [c.id, c]));
  const candidateList = candidates
    .map((c) => {
      const ingredients = c.ner
        ? JSON.parse(c.ner).join(', ')
        : c.ingredients || 'N/A';
      return `ID: ${c.id} — ${c.name} — Ingredients: ${ingredients}`;
    })
    .join('\n');

  const prompt = `Pantry items available: ${pantryNames.join(', ')}

Here are candidate recipes found via similarity search:
${candidateList}

Task: Select the top recipes the user can actually make with their pantry.
Score each by coverage (what % of recipe ingredients are in pantry).
Return ONLY a JSON array of objects with these exact fields:
- id (number, MUST be the exact ID from the candidate list above, e.g. 3513)
- name (string)
- score (number 0-1, coverage ratio)
- reasoning (string, e.g. "Missing: eggs, flour" or "All ingredients available")

CRITICAL: Use the exact numeric ID from the candidate list. Do NOT invent or change IDs.
Only include recipes with score > 0.2. Return at most ${RAG_MAX_RESULTS} recipes.
Sort by score descending.`;

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), RERANK_TIMEOUT_MS);

  const resp = await fetch(`${OPENROUTER_URL}/chat/completions`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${OPENROUTER_API_KEY}`,
      'Content-Type': 'application/json',
      'HTTP-Referer': 'https://recipic.app',
      'X-Title': 'ReciPic',
    },
    body: JSON.stringify({
      model: CHAT_MODEL,
      messages: [{ role: 'user', content: prompt }],
      temperature: 0,
      max_tokens: 1024,
      provider: { order: ['alibaba','OpenRouter','Novita', 'DeepInfra', 'Fireworks', 'Hyperbolic'] },
    }),
    signal: controller.signal,
  }).finally(() => clearTimeout(timeout));

  const data = await resp.json().catch(() => ({}));
  if (data.error || !data.choices?.length) {
    console.error('OpenRouter RAG error:', data.error || 'No choices');
    return [];
  }

  const content = data.choices[0].message.content;
  const jsonStr = extractJSON(content);

  try {
    const parsed = JSON.parse(jsonStr);
    if (Array.isArray(parsed)) {
      return parsed
        .filter(
          (r: any) => r.id && r.name && typeof r.score === 'number',
        )
        .map((r: any) => {
          let id = Number(r.id);
          // Fallback: if LLM hallucinated an ID, try to match by name
          if (!candidateMap.has(id)) {
            const byName = candidates.find(
              (c) => c.name.toLowerCase().trim() === r.name.toLowerCase().trim(),
            );
            if (byName) id = byName.id;
          }
          return {
            id,
            name: r.name,
            score: Math.min(1, Math.max(0, r.score)),
            reasoning: r.reasoning || '',
          };
        })
        .filter((r: any) => candidateMap.has(r.id))
        .sort((a: any, b: any) => b.score - a.score)
        .slice(0, RAG_MAX_RESULTS);
    }
  } catch {
    console.error('Failed to parse RAG JSON:', jsonStr);
  }

  return [];
}

// ── GET handler ─────────────────────────────────────────────────────
export async function GET() {
  // 1. Fetch pantry items
  const items = db.select().from(pantry).all();
  if (!items.length) {
    return json({ recipes: [], pantry: [] });
  }

  const pantryNames = items
    .map((i) => i.name.toLowerCase().trim())
    .filter(Boolean);
  if (!pantryNames.length) {
    return json({ recipes: [], pantry: items });
  }

  // 2. Generate query embedding from pantry items
  const queryText = `recipes with: ${pantryNames.join(', ')}`;
  const queryEmbedding = await embedText(queryText);

  // 3. Vector similarity search
  const vectorResults = vectorSearch(queryEmbedding, VECTOR_TOP_K);
  if (!vectorResults.length) {
    return json({ recipes: [], pantry: items });
  }

  // Build distance map: recipe ID → vector distance
  const distanceMap = new Map<number, number>();
  for (const r of vectorResults) {
    const id = parseInt(r.metadata, 10);
    if (!isNaN(id)) distanceMap.set(id, r.distance);
  }

  // 4. Fetch full recipe data for candidates
  const ids = vectorResults.map((r) => parseInt(r.metadata, 10));

  const placeholders = ids.map(() => '?').join(',');
  const candidates = sqlite
    .prepare(
      `SELECT id, name, ner, ingredients, instructions, link FROM recipes WHERE id IN (${placeholders})`,
    )
    .all(...ids) as {
    id: number;
    name: string;
    ner: string | null;
    ingredients: string | null;
    instructions: string | null;
    link: string | null;
  }[];

  // 5. RAG reranking
  const ranked = await rerankWithLLM(pantryNames, candidates);

  // 6. Build response
  const candidateMap = new Map(candidates.map((c) => [c.id, c]));
  const pantrySet = new Set(pantryNames);

  const recipes = ranked.map((r) => {
    const full = candidateMap.get(Number(r.id));
    let ingredientCount = 0;
    let recipeNer: string[] = [];

    if (full?.ner) {
      try {
        recipeNer = JSON.parse(full.ner);
        ingredientCount = recipeNer.length;
      } catch {
        recipeNer = (full.ingredients?.split(',').map((s) => s.trim())) || [];
        ingredientCount = recipeNer.length;
      }
    } else if (full?.ingredients) {
      recipeNer = full.ingredients.split(',').map((s) => s.trim());
      ingredientCount = recipeNer.length;
    }

    // Compute real ingredient matches: pantry ∩ recipe NER
    const matches = recipeNer
      .filter((ing) => pantrySet.has(ing.toLowerCase().trim()))
      .map((ing) => ing.trim());

    return {
      id: r.id,
      name: r.name,
      description: null,
      ingredients: full?.ingredients || null,
      instructions: full?.instructions || null,
      ingredientCount,
      link: full?.link || null,
      score: r.score,
      reasoning: r.reasoning,
      matchCount: matches.length,
      matches,
      distance: distanceMap.get(Number(r.id)) ?? null,
    };
  });

  return json({ recipes, pantry: items });
}
