import { json } from '@sveltejs/kit';
import { db, sqlite } from '$lib/db';
import { pantry } from '$lib/db/schema';
import { OPENROUTER_API_KEY } from '$env/static/private';

const OPENROUTER_URL = 'https://openrouter.ai/api/v1';
const EMBEDDING_MODEL = 'perplexity/pplx-embed-v1-4b'; // 2560-dim
const CHAT_MODEL = 'qwen/qwen3.6-flash';
const VECTOR_TOP_K = 40;
const RAG_MAX_RESULTS = 10;

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

// ── Generate embedding via OpenRouter ───────────────────────────────
async function embedText(text: string): Promise<Float32Array> {
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
  });

  if (!resp.ok) {
    const err = await resp.text();
    throw new Error(`Embedding API error ${resp.status}: ${err}`);
  }

  const data = await resp.json();
  const embedding = data.data?.[0]?.embedding;
  if (!embedding) throw new Error('No embedding returned from API');
  return new Float32Array(embedding);
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
  const candidateList = candidates
    .map((c, i) => {
      const ingredients = c.ner
        ? JSON.parse(c.ner).join(', ')
        : c.ingredients || 'N/A';
      return `${i + 1}. ${c.name} — Ingredients: ${ingredients}`;
    })
    .join('\n');

  const prompt = `Pantry items available: ${pantryNames.join(', ')}

Here are candidate recipes found via similarity search:
${candidateList}

Task: Select the top recipes the user can actually make with their pantry.
Score each by coverage (what % of recipe ingredients are in pantry).
Return ONLY a JSON array of objects with these exact fields:
- id (number, the recipe id from the list above)
- name (string)
- score (number 0-1, coverage ratio)
- reasoning (string, e.g. "Missing: eggs, flour" or "All ingredients available")

Only include recipes with score > 0.2. Return at most ${RAG_MAX_RESULTS} recipes.
Sort by score descending.`;

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
      provider: { order: ['Novita', 'DeepInfra', 'Fireworks', 'Hyperbolic'] },
    }),
  });

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
        .map((r: any) => ({
          id: r.id,
          name: r.name,
          score: Math.min(1, Math.max(0, r.score)),
          reasoning: r.reasoning || '',
        }))
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

  // 4. Fetch full recipe data for candidates
  const ids = vectorResults.map((r) => parseInt(r.metadata, 10));
  const candidates = sqlite
    .prepare(
      `SELECT id, name, ner, ingredients, link FROM recipes WHERE id IN (${ids.join(',')})`,
    )
    .all() as {
    id: number;
    name: string;
    ner: string | null;
    ingredients: string | null;
    link: string | null;
  }[];

  // 5. RAG reranking
  const ranked = await rerankWithLLM(pantryNames, candidates);

  // 6. Build response
  const candidateMap = new Map(candidates.map((c) => [c.id, c]));
  const recipes = ranked.map((r) => {
    const full = candidateMap.get(r.id);
    return {
      id: r.id,
      name: r.name,
      description: null,
      ingredients: full?.ingredients || null,
      instructions: null,
      link: full?.link || null,
      score: r.score,
      reasoning: r.reasoning,
      matchCount: Math.round(r.score * 10),
      matches: [],
    };
  });

  return json({ recipes, pantry: items });
}
