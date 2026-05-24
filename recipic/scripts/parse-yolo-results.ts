/**
 * parse-yolo-results.ts — Parse YOLOv8 training results.csv and output
 * aggregate metrics in the same format as evaluate-vl.ts for comparison.
 *
 * Run:
 *   npx tsx scripts/parse-yolo-results.ts <results.csv>
 *
 * Outputs the FINAL epoch metrics (fully trained model) plus per-class if available.
 */

import { readFileSync, existsSync } from 'node:fs';
import { resolve } from 'node:path';

const csvPath = resolve(process.argv[2] || './results.csv');

if (!existsSync(csvPath)) {
  console.error(`File not found: ${csvPath}`);
  console.error('Usage: npx tsx scripts/parse-yolo-results.ts <path/to/results.csv>');
  process.exit(1);
}

const raw = readFileSync(csvPath, 'utf-8');
const lines = raw.trim().split('\n');
const headers = lines[0].split(',');

// Find relevant columns
const col = (name: string) => headers.findIndex(h => h.trim() === name);

const epochCol = col('epoch');
const pCol = col('metrics/precision(B)');
const rCol = col('metrics/recall(B)');
const mAP50Col = col('metrics/mAP50(B)');
const mAP50_95Col = col('metrics/mAP50-95(B)');
const boxLossCol = col('val/box_loss');
const clsLossCol = col('val/cls_loss');
const timeCol = col('time');

// Parse all epochs
const epochs: { epoch: number; precision: number; recall: number; mAP50: number; mAP50_95: number; boxLoss: number; clsLoss: number; time: number }[] = [];

for (let i = 1; i < lines.length; i++) {
  const cols = lines[i].split(',');
  const epoch = parseInt(cols[epochCol]);
  if (isNaN(epoch)) continue;

  const p = parseFloat(cols[pCol]) || 0;
  const r = parseFloat(cols[rCol]) || 0;
  const m50 = parseFloat(cols[mAP50Col]) || 0;
  const m50_95 = parseFloat(cols[mAP50_95Col]) || 0;
  const bl = parseFloat(cols[boxLossCol]) || 0;
  const cl = parseFloat(cols[clsLossCol]) || 0;
  const t = parseFloat(cols[timeCol]) || 0;

  epochs.push({ epoch, precision: p, recall: r, mAP50: m50, mAP50_95: m50_95, boxLoss: bl, clsLoss: cl, time: t });
}

if (epochs.length === 0) {
  console.error('No valid epochs found in CSV.');
  process.exit(1);
}

const last = epochs[epochs.length - 1];
const best = epochs.reduce((a, b) => b.mAP50 > a.mAP50 ? b : a, epochs[0]);

// Compute F1 from precision/recall
const f1 = (p: number, r: number) => (p + r > 0 ? 2 * p * r / (p + r) : 0);

console.log('\n' + '='.repeat(70));
console.log('YOLOv8 TRAINING RESULTS');
console.log('='.repeat(70));
console.log(`CSV:            ${csvPath}`);
console.log(`Total epochs:   ${epochs.length}`);
console.log(`Total time:     ${epochs[epochs.length - 1].time.toFixed(1)}s (${(epochs[epochs.length - 1].time / 60).toFixed(1)} min)`);
console.log('');

// ── Final epoch ──────────────────────────────────────────────────
console.log('─'.repeat(70));
console.log('FINAL EPOCH  (epoch ' + last.epoch + ')');
console.log('─'.repeat(70));
console.log(`Precision:       ${(last.precision * 100).toFixed(1)}%`);
console.log(`Recall:          ${(last.recall * 100).toFixed(1)}%`);
console.log(`F1 Score:        ${(f1(last.precision, last.recall) * 100).toFixed(1)}%`);
console.log(`mAP@50:          ${(last.mAP50 * 100).toFixed(2)}%`);
console.log(`mAP@50-95:       ${(last.mAP50_95 * 100).toFixed(2)}%`);
console.log(`Val Box Loss:    ${last.boxLoss.toFixed(4)}`);
console.log(`Val Cls Loss:    ${last.clsLoss.toFixed(4)}`);

// ── Best epoch ───────────────────────────────────────────────────
if (best.epoch !== last.epoch) {
  console.log('');
  console.log('─'.repeat(70));
  console.log('BEST EPOCH   (epoch ' + best.epoch + ', highest mAP50)');
  console.log('─'.repeat(70));
  console.log(`Precision:       ${(best.precision * 100).toFixed(1)}%`);
  console.log(`Recall:          ${(best.recall * 100).toFixed(1)}%`);
  console.log(`F1 Score:        ${(f1(best.precision, best.recall) * 100).toFixed(1)}%`);
  console.log(`mAP@50:          ${(best.mAP50 * 100).toFixed(2)}%`);
  console.log(`mAP@50-95:       ${(best.mAP50_95 * 100).toFixed(2)}%`);
}

// ── Epoch progression ────────────────────────────────────────────
console.log('');
console.log('─'.repeat(70));
console.log('EPOCH PROGRESSION');
console.log('─'.repeat(70));
console.log(`${'Epoch'.padStart(5)} ${'P(%)'.padStart(6)} ${'R(%)'.padStart(6)} ${'mAP50(%)'.padStart(9)} ${'mAP50-95(%)'.padStart(11)} ${'Time(s)'.padStart(8)}`);
console.log('-'.repeat(55));

const step = Math.max(1, Math.floor(epochs.length / 20)); // Show ~20 data points
for (let i = 0; i < epochs.length; i += step) {
  const e = epochs[i];
  console.log(
    `${String(e.epoch).padStart(5)} ${(e.precision * 100).toFixed(1).padStart(6)} ${(e.recall * 100).toFixed(1).padStart(6)} ${(e.mAP50 * 100).toFixed(2).padStart(9)} ${(e.mAP50_95 * 100).toFixed(2).padStart(11)} ${e.time.toFixed(0).padStart(8)}`,
  );
}

// ── Comparison placeholder ───────────────────────────────────────
console.log('');
console.log('='.repeat(70));
console.log('COMPARISON: YOLOv8 vs VL Model (fill in VL results from evaluate-vl.ts)');
console.log('='.repeat(70));
console.log(`${'Metric'.padEnd(20)} ${'YOLOv8'.padStart(10)} ${'VL Model'.padStart(12)}`);
console.log('-'.repeat(45));
console.log(`${'Precision'.padEnd(20)} ${(best.precision * 100).toFixed(1).padStart(9)}%   ${'___%'.padStart(8)}`);
console.log(`${'Recall'.padEnd(20)} ${(best.recall * 100).toFixed(1).padStart(9)}%   ${'___%'.padStart(8)}`);
console.log(`${'F1 Score'.padEnd(20)} ${(f1(best.precision, best.recall) * 100).toFixed(1).padStart(9)}%   ${'___%'.padStart(8)}`);
console.log(`${'mAP@50'.padEnd(20)} ${(best.mAP50 * 100).toFixed(2).padStart(9)}%   ${'N/A'.padStart(9)}`);
console.log(`${'mAP@50-95'.padEnd(20)} ${(best.mAP50_95 * 100).toFixed(2).padStart(9)}%   ${'N/A'.padStart(9)}`);
console.log('');
console.log('Note: VL model evaluates ingredient NAME detection (no bounding boxes).');
console.log('      YOLOv8 evaluates bounding box detection + classification.');
console.log('      Precision/Recall/F1 are comparable. mAP is bbox-only (YOLOv8).');
console.log('');
