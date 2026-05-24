/**
 * evaluate-vl.ts — Evaluate VL ingredient detection accuracy against Roboflow dataset.
 *
 * Supports Roboflow COCO JSON export format:
 *   dataset/test/_annotations.coco.json + images/*.jpg
 *
 * Run from anywhere (auto-finds .env):
 *   npx tsx scripts/evaluate-vl.ts ./eval_dataset --limit=50
 *   npx tsx scripts/evaluate-vl.ts ./eval_dataset --dry
 *
 * Options:
 *   dataset-dir   Path to Roboflow dataset (default: ./eval_dataset)
 *   --limit N     Max images to evaluate (default: 50)
 *   --dry         Dry run: show images but don't call VL API
 */

import { readFileSync, readdirSync, existsSync } from 'node:fs';
import { resolve, join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import dotenv from 'dotenv';

// Auto-load .env from multiple possible locations
const __dirname = dirname(fileURLToPath(import.meta.url));
const envPaths = [
  join(process.cwd(), '.env'),          // cwd
  join(process.cwd(), 'recipic', '.env'), // workspace root
  join(__dirname, '..', '.env'),         // script parent dir
];
for (const p of envPaths) {
  if (existsSync(p)) { dotenv.config({ path: p }); break; }
}

// ── Config ──────────────────────────────────────────────────────────
const VL_MODEL = 'qwen/qwen3-vl-30b-a3b-instruct';
const OPENROUTER_URL = 'https://openrouter.ai/api/v1/chat/completions';
const API_KEY = process.env.OPENROUTER_API_KEY;
if (!API_KEY) {
  console.error('OPENROUTER_API_KEY not found. Checked:', envPaths);
  console.error('Ensure .env file exists with OPENROUTER_API_KEY=sk-or-v1-...');
  process.exit(1);
}

// ── CLI args ────────────────────────────────────────────────────────
const args = process.argv.slice(2);
const datasetDir = resolve(args.find(a => !a.startsWith('--')) || './eval_dataset');
const limit = parseInt(args.find(a => a.startsWith('--limit='))?.split('=')[1] || '50');
const dryRun = args.includes('--dry');

// ── Types ───────────────────────────────────────────────────────────
interface CocoAnnotation {
  image_id: number;
  category_id: number;
  bbox: [number, number, number, number]; // [x, y, w, h] in pixels
  area: number;
  id: number;
}

interface CocoImage {
  id: number;
  file_name: string;
  width: number;
  height: number;
}

interface CocoCategory {
  id: number;
  name: string;
  supercategory?: string;
}

interface CocoDataset {
  images: CocoImage[];
  annotations: CocoAnnotation[];
  categories: CocoCategory[];
}

interface EvalResult {
  image: string;
  groundTruth: string[];
  predicted: string[];
  precision: number;
  recall: number;
  f1: number;
  falsePositives: string[];
  falseNegatives: string[];
  vlTimeMs: number;
}

// ── Helpers ─────────────────────────────────────────────────────────

/** Load COCO JSON from Roboflow export */
function loadCocoDataset(dir: string): { dataset: CocoDataset; imageDir: string } | null {
  // Roboflow exports annotations to _annotations.coco.json in the split dir
  const possiblePaths = [
    join(dir, '_annotations.coco.json'),
    join(dir, 'test', '_annotations.coco.json'),
    join(dir, 'valid', '_annotations.coco.json'),
    join(dir, 'train', '_annotations.coco.json'),
  ];

  let cocoPath = '';
  let imageDir = dir;
  for (const p of possiblePaths) {
    if (existsSync(p)) {
      cocoPath = p;
      imageDir = resolve(p, '..');
      break;
    }
  }

  if (!cocoPath) {
    console.error('No _annotations.coco.json found in:', dir);
    console.error('Expected Roboflow COCO export format: dataset/test/_annotations.coco.json');
    return null;
  }

  const raw = JSON.parse(readFileSync(cocoPath, 'utf-8'));
  return { dataset: raw as CocoDataset, imageDir };
}

/** Normalize ingredient name — lowercase, strip plurals, trim */
function normalizeName(name: string): string {
  return name
    .toLowerCase()
    .replace(/s$/, '')          // simple plural strip
    .replace(/[^a-z ]/g, '')    // remove special chars
    .trim();
}

/** Match VL output name against ground truth names (fuzzy) */
function matchesGroundTruth(pred: string, gtNames: string[]): boolean {
  const norm = normalizeName(pred);
  if (!norm || norm.length < 2) return false;

  return gtNames.some(gt => {
    const ngt = normalizeName(gt);
    // Exact match after normalization
    if (norm === ngt) return true;
    // Substring match (e.g., "red onion" contains "onion")
    if (norm.includes(ngt) || ngt.includes(norm)) return true;
    return false;
  });
}

/** Compute per-image metrics */
function computeMetrics(predicted: string[], groundTruth: string[]): {
  precision: number; recall: number; f1: number;
  falsePositives: string[]; falseNegatives: string[];
} {
  const tp = predicted.filter(p => matchesGroundTruth(p, groundTruth));
  const fp = predicted.filter(p => !matchesGroundTruth(p, groundTruth));
  const fn = groundTruth.filter(g => !predicted.some(p => matchesGroundTruth(p, [g])));

  const precision = predicted.length > 0 ? tp.length / predicted.length : 0;
  const recall = groundTruth.length > 0 ? tp.length / groundTruth.length : 0;
  const f1 = precision + recall > 0 ? 2 * precision * recall / (precision + recall) : 0;

  return { precision, recall, f1, falsePositives: fp, falseNegatives: fn };
}

/** Call VL model for one image */
async function detectIngredients(imagePath: string): Promise<{ names: string[]; ms: number }> {
  const imgBuf = readFileSync(imagePath);
  const base64 = imgBuf.toString('base64');
  const ext = imagePath.split('.').pop()?.toLowerCase() || 'jpeg';
  const mime = ext === 'png' ? 'image/png' : ext === 'webp' ? 'image/webp' : 'image/jpeg';
  const dataURL = `data:${mime};base64,${base64}`;

  const prompt = `List ingredients visible in this image. Use general names only (e.g. "tomato" not "roma tomato").

RULES:
- JSON ONLY, no explanation
- 1-2 word generic names
- Include count for each ingredient

OUTPUT:
{"ingredients":[{"name":"tomato","count":3},{"name":"onion","count":2}]}`;

  const t0 = performance.now();

  const resp = await fetch(OPENROUTER_URL, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${API_KEY}`,
      'Content-Type': 'application/json',
      'HTTP-Referer': 'https://recipic.app',
      'X-Title': 'ReciPic Eval',
    },
    body: JSON.stringify({
      model: VL_MODEL,
      messages: [{
        role: 'user',
        content: [
          { type: 'text', text: prompt },
          { type: 'image_url', image_url: { url: dataURL } },
        ],
      }],
      temperature: 0,
      max_tokens: 256,
      provider: { order: ['alibaba', 'Alibaba Cloud', 'OpenRouter'] },
    }),
  });

  const ms = Math.round(performance.now() - t0);
  const data = await resp.json().catch(() => ({}));

  if (data.error || !data.choices?.length) {
    console.warn(`  VL error: ${data.error?.message || 'no response'}`);
    return { names: [], ms };
  }

  const content = data.choices[0].message.content;
  // Extract JSON
  let jsonStr = content.trim();
  const m = jsonStr.match(/```(?:json)?\s*([\s\S]*?)```/);
  if (m) jsonStr = m[1].trim();

  try {
    const parsed = JSON.parse(jsonStr);
    return {
      names: (parsed.ingredients || []).map((i: any) => String(i.name || '').toLowerCase().trim()).filter(Boolean),
      ms,
    };
  } catch {
    console.warn(`  VL parse error: ${jsonStr.slice(0, 100)}`);
    return { names: [], ms };
  }
}

// ── Main ────────────────────────────────────────────────────────────
async function main() {
  console.log(`\n🔬 ReciPic VL Evaluation\n`);
  console.log(`Dataset: ${datasetDir}`);
  console.log(`Model:   ${VL_MODEL}`);
  console.log(`Limit:   ${limit} images`);
  if (dryRun) console.log(`Mode:    DRY RUN (no API calls)\n`);

  const loaded = loadCocoDataset(datasetDir);
  if (!loaded) process.exit(1);

  const { dataset, imageDir } = loaded;
  console.log(`Loaded:  ${dataset.images.length} images, ${dataset.annotations.length} annotations, ${dataset.categories.length} categories\n`);

  // Build lookup: image_id → ground truth class names (unique)
  const gtMap = new Map<number, string[]>();
  for (const ann of dataset.annotations) {
    const cat = dataset.categories.find(c => c.id === ann.category_id);
    if (!cat) continue;
    const list = gtMap.get(ann.image_id) || [];
    if (!list.includes(cat.name)) list.push(cat.name);
    gtMap.set(ann.image_id, list);
  }

  // Pick images to evaluate (prefer those with annotations)
  const evalImages = dataset.images
    .filter(img => gtMap.has(img.id))
    .slice(0, limit);

  if (evalImages.length === 0) {
    console.error('No annotated images found.');
    process.exit(1);
  }

  console.log(`Evaluating ${evalImages.length} annotated images...\n`);
  console.log(`${'Image'.padEnd(40)} ${'GT'.padEnd(6)} ${'Pred'.padEnd(6)} P     R     F1    Time`);
  console.log('-'.repeat(90));

  const results: EvalResult[] = [];
  let totalTime = 0;

  for (let i = 0; i < evalImages.length; i++) {
    const img = evalImages[i];
    const imgPath = join(imageDir, img.file_name);
    const gtNames = gtMap.get(img.id) || [];

    if (!existsSync(imgPath)) {
      console.warn(`  [${i + 1}/${evalImages.length}] MISSING: ${img.file_name}`);
      continue;
    }

    let predNames: string[] = [];
    let vlMs = 0;

    if (dryRun) {
      // Simulate
      predNames = gtNames.slice(0, Math.ceil(gtNames.length * 0.7));
    } else {
      // Call VL
      const result = await detectIngredients(imgPath);
      predNames = result.names;
      vlMs = result.ms;
    }

    const metrics = computeMetrics(predNames, gtNames);
    totalTime += vlMs;

    const line = [
      img.file_name.slice(0, 38).padEnd(40),
      String(gtNames.length).padEnd(6),
      String(predNames.length).padEnd(6),
      metrics.precision.toFixed(2).padStart(5),
      metrics.recall.toFixed(2).padStart(5),
      metrics.f1.toFixed(2).padStart(5),
      vlMs > 0 ? `${vlMs}ms` : '-',
    ].join(' ');

    console.log(line);

    if (metrics.falsePositives.length > 0) {
      console.log(`  FP: ${metrics.falsePositives.join(', ')}`);
    }
    if (metrics.falseNegatives.length > 0) {
      console.log(`  FN: ${metrics.falseNegatives.join(', ')}`);
    }

    results.push({
      image: img.file_name,
      groundTruth: gtNames,
      predicted: predNames,
      ...metrics,
      vlTimeMs: vlMs,
    });
  }

  // ── Aggregate metrics ────────────────────────────────────────────
  console.log('\n' + '='.repeat(70));
  console.log('AGGREGATE RESULTS');
  console.log('='.repeat(70));

  const avgPrecision = results.reduce((s, r) => s + r.precision, 0) / results.length;
  const avgRecall = results.reduce((s, r) => s + r.recall, 0) / results.length;
  const avgF1 = results.reduce((s, r) => s + r.f1, 0) / results.length;
  const avgTime = totalTime / results.length;

  console.log(`Images evaluated:  ${results.length}`);
  console.log(`Avg Precision:     ${(avgPrecision * 100).toFixed(1)}%`);
  console.log(`Avg Recall:        ${(avgRecall * 100).toFixed(1)}%`);
  console.log(`Avg F1 Score:      ${(avgF1 * 100).toFixed(1)}%`);
  console.log(`Avg VL Time:       ${Math.round(avgTime)}ms`);
  console.log(`Total VL Time:     ${(totalTime / 1000).toFixed(1)}s`);

  // Per-class breakdown
  const classStats = new Map<string, { tp: number; gt: number; pred: number }>();
  for (const r of results) {
    for (const gt of r.groundTruth) {
      const s = classStats.get(gt) || { tp: 0, gt: 0, pred: 0 };
      s.gt++;
      classStats.set(gt, s);
    }
    for (const pred of r.predicted) {
      const s = classStats.get(pred) || { tp: 0, gt: 0, pred: 0 };
      s.pred++;
      classStats.set(pred, s);
    }
    for (const pred of r.predicted) {
      if (matchesGroundTruth(pred, r.groundTruth)) {
        const s = classStats.get(pred) || { tp: 0, gt: 0, pred: 0 };
        s.tp++;
        classStats.set(pred, s);
      }
    }
  }

  console.log('\nPer-Class Breakdown:');
  console.log(`${'Class'.padEnd(25)} ${'GT'.padEnd(6)} ${'Pred'.padEnd(6)} P       R       F1`);
  console.log('-'.repeat(65));
  for (const [cls, stats] of [...classStats.entries()].sort((a, b) => b[1].gt - a[1].gt)) {
    const p = stats.pred > 0 ? stats.tp / stats.pred : 0;
    const r = stats.gt > 0 ? stats.tp / stats.gt : 0;
    const f = p + r > 0 ? 2 * p * r / (p + r) : 0;
    console.log(
      `${cls.slice(0, 23).padEnd(25)} ${String(stats.gt).padEnd(6)} ${String(stats.pred).padEnd(6)} ${p.toFixed(2).padStart(6)} ${r.toFixed(2).padStart(6)} ${f.toFixed(2).padStart(6)}`,
    );
  }

  console.log('\nDone.\n');
}

main().catch(err => {
  console.error('Fatal:', err);
  process.exit(1);
});
