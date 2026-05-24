import { json, error } from '@sveltejs/kit';
import { OPENROUTER_API_KEY } from '$env/static/private';

const OpenRouterAPIURL = 'https://openrouter.ai/api/v1/chat/completions';

// VL model for image → ingredient detection with bounding boxes
// -instruct = non-thinking (fast). -thinking = chain-of-thought (60s+, avoid for detection)
const VL_MODEL = 'qwen/qwen3-vl-30b-a3b-instruct';

// DeepSeek V4 for post-processing / refinement (text-only, cheaper)
const REFINE_MODEL = 'deepseek/deepseek-v4-flash';

interface BBox {
	x: number;
	y: number;
	w: number;
	h: number;
}

interface Ingredient {
	name: string;
	count: number;
	bboxes?: BBox[];  // one bbox per individual item
}

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

/** Attempt to salvage truncated JSON by closing unclosed brackets/braces */
function repairJSON(raw: string): string {
	let s = raw.trim();
	// Count open/close brackets and braces
	let braces = 0, brackets = 0;
	let inString = false, escaped = false;
	for (const ch of s) {
		if (escaped) { escaped = false; continue; }
		if (ch === '\\') { escaped = true; continue; }
		if (ch === '"') { inString = !inString; continue; }
		if (inString) continue;
		if (ch === '{') braces++;
		if (ch === '}') braces--;
		if (ch === '[') brackets++;
		if (ch === ']') brackets--;
	}
	// Close any unclosed strings, brackets, braces
	if (inString) s += '"';
	while (brackets > 0) { s += ']'; brackets--; }
	while (braces > 0) { s += '}'; braces--; }
	return s;
}

/** Parse JSON with truncation recovery */
function safeParseJSON(raw: string): unknown {
	// Try direct parse first
	try { return JSON.parse(raw); } catch {}
	// Try repair
	try { return JSON.parse(repairJSON(raw)); } catch {}
	throw new Error(`Unparseable JSON: ${raw.slice(0, 300)}`);
}

/** Parse bbox from VL response. Handles {x,y,w,h}, [x,y,w,h], {x,y,width,height}. Clamps to [0,1]. */
function parseBBox(raw: unknown): BBox | null {
	if (!raw || typeof raw !== 'object') return null;
	const arr = Array.isArray(raw) ? raw : null;
	const obj = !arr ? raw as Record<string, unknown> : null;

	let x: number, y: number, w: number, h: number;

	if (arr && arr.length >= 4) {
		[x, y, w, h] = arr.map(Number);
	} else if (obj) {
		x = Number(obj.x ?? 0);
		y = Number(obj.y ?? 0);
		w = Number(obj.w ?? obj.width ?? 0);
		h = Number(obj.h ?? obj.height ?? 0);
	} else {
		return null;
	}

	if ([x, y, w, h].some(v => isNaN(v) || v < 0 || v > 1)) return null;
	if (w === 0 || h === 0) return null;

	return { x, y, w, h };
}

/** Call VL model to detect ingredients (names + counts, no bbox). */
async function detectWithVL(dataURL: string): Promise<Ingredient[]> {
	const prompt = `List ingredients visible in this image. Use general names only (e.g. "tomato" not "roma tomato").

RULES:
- JSON ONLY, no explanation
- 1-2 word generic names
- Include count for each ingredient

OUTPUT:
{"ingredients":[{"name":"tomato","count":3},{"name":"onion","count":2}]}`;

	const reqBody = {
		model: VL_MODEL,
		messages: [{
			role: 'user' as const,
			content: [
				{ type: 'text' as const, text: prompt },
				{ type: 'image_url' as const, image_url: { url: dataURL } }
			]
		}],
		temperature: 0,
		max_tokens: 256,
		provider: { order: ['alibaba', 'Alibaba Cloud', 'OpenRouter'] }
	};

	const controller = new AbortController();
	const timeout = setTimeout(() => controller.abort(), 30000);

	const resp = await fetch(OpenRouterAPIURL, {
		method: 'POST',
		headers: {
			Authorization: `Bearer ${OPENROUTER_API_KEY}`,
			'Content-Type': 'application/json',
			'HTTP-Referer': 'https://recipic.app',
			'X-Title': 'ReciPic'
		},
		body: JSON.stringify(reqBody),
		signal: controller.signal
	}).finally(() => clearTimeout(timeout));

	const apiResp = await resp.json().catch(() => ({}));
	if (apiResp.error) error(502, apiResp.error.message || 'VL API error');
	if (!apiResp.choices?.length) error(502, 'No response from VL API');

	const content = apiResp.choices[0].message.content;
	const finishReason = apiResp.choices[0].finish_reason || '';
	const jsonStr = extractJSON(content);

	let analysis: { ingredients?: unknown[] };
	try {
		analysis = safeParseJSON(jsonStr) as { ingredients?: unknown[] };
	} catch {
		error(502, `VL returned invalid JSON (finish=${finishReason}): ${jsonStr.slice(0, 300)}`);
	}

	if (finishReason === 'length') {
		console.warn('VL output truncated (max_tokens hit).');
	}

	return (analysis.ingredients || []).map((ing: unknown) => {
		const item = ing as Record<string, unknown>;
		return {
			name: String(item.name || '').toLowerCase().trim(),
			count: Math.max(1, parseInt(String(item.count)) || 1)
		};
	}).filter((ing: Ingredient) => ing.name.length > 0 && ing.name.length < 50);
}

/** Call DeepSeek V4 to refine ingredient list: merge duplicates, fix names, validate counts. */
async function refineWithLLM(ingredients: Ingredient[]): Promise<Ingredient[]> {
	if (ingredients.length === 0) return [];

	const names = ingredients.map(i => `${i.name} (x${i.count})`).join(', ');

	const prompt = `Refine this ingredient list detected from an image. Your job:
1. Merge duplicates (e.g. "tomato" + "tomatoes" → "tomato", sum counts)
2. Fix any obviously wrong names (keep general names, 1-2 words)
3. Remove items that don't look like real food ingredients
4. Keep the count reasonable (don't inflate)

Input: ${names}

STRICT RULES:
- JSON ONLY, no explanation
- Return ALL valid ingredients (don't drop correct ones)
- Keep original counts unless you're merging

OUTPUT:
{"ingredients":[{"name":"tomato","count":5},{"name":"onion","count":2}]}`;

	const reqBody = {
		model: REFINE_MODEL,
		messages: [{ role: 'user' as const, content: prompt }],
		temperature: 0,
		max_tokens: 512
	};

	const controller = new AbortController();
	const timeout = setTimeout(() => controller.abort(), 15000);

	const resp = await fetch(OpenRouterAPIURL, {
		method: 'POST',
		headers: {
			Authorization: `Bearer ${OPENROUTER_API_KEY}`,
			'Content-Type': 'application/json',
			'HTTP-Referer': 'https://recipic.app',
			'X-Title': 'ReciPic'
		},
		body: JSON.stringify(reqBody),
		signal: controller.signal
	}).finally(() => clearTimeout(timeout));

	const apiResp = await resp.json().catch(() => ({}));
	if (apiResp.error || !apiResp.choices?.length) {
		// Refinement is optional — fall back to original list
		console.warn('Refine skipped:', apiResp.error?.message || 'no response');
		return ingredients;
	}

	const content = apiResp.choices[0].message.content;
	const jsonStr = extractJSON(content);

		try {
			const refined = JSON.parse(jsonStr);
			const refinedList = (refined.ingredients || []).map((ing: Record<string, unknown>) => ({
				name: String(ing.name || '').toLowerCase().trim(),
				count: Math.max(1, parseInt(String(ing.count)) || 1)
			}));

			if (refinedList.length === 0) return ingredients; // fallback
			return refinedList;
		} catch {
		console.warn('Refine JSON parse failed, using original');
		return ingredients;
	}
}

export async function POST({ request }) {
	const t0 = performance.now();
	const form = await request.formData();
	const file = form.get('image') as File;
	const refine = form.get('refine') !== 'false'; // default true

	if (!file) error(400, 'No image provided');

	const bytes = new Uint8Array(await file.arrayBuffer());
	const base64 = Buffer.from(bytes).toString('base64');
	const dataURL = `data:${file.type || 'image/jpeg'};base64,${base64}`;

	// Step 1: Detect ingredients with bounding boxes using VL model
	const t1 = performance.now();
	let ingredients = await detectWithVL(dataURL);
	const vlMs = Math.round(performance.now() - t1);

	// Step 2: Optionally refine with DeepSeek V4 (text-only, cheaper)
	let refineMs = 0;
	if (refine && ingredients.length > 0) {
		const t2 = performance.now();
		try {
			ingredients = await refineWithLLM(ingredients);
		} catch {
			// Refinement failed — use VL results as-is
		}
		refineMs = Math.round(performance.now() - t2);
	}

	const totalMs = Math.round(performance.now() - t0);

	return json({
		ingredients,
		timings: { vl_ms: vlMs, refine_ms: refineMs, total_ms: totalMs }
	});
}
