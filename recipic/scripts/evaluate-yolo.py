#!/usr/bin/env python3
"""
evaluate-yolo.py — Evaluate YOLOv8 model on the same Roboflow COCO dataset.
Outputs metrics in the same format as evaluate-vl.ts for direct comparison.

Usage:
  python3 scripts/evaluate-yolo.py <model.pt> <dataset_dir> [--limit N]

Example:
  python3 scripts/evaluate-yolo.py yolov8n.pt ./eval_dataset --limit 50

Requirements:
  pip install ultralytics
"""

import argparse
import json
import os
import sys
import time
from pathlib import Path

try:
    from ultralytics import YOLO
except ImportError:
    print("Install ultralytics: pip install ultralytics")
    sys.exit(1)


def load_coco_dataset(dataset_dir: str):
    """Load COCO JSON from Roboflow export. Returns (images, annotations, categories)."""
    possible = [
        os.path.join(dataset_dir, "_annotations.coco.json"),
        os.path.join(dataset_dir, "test", "_annotations.coco.json"),
        os.path.join(dataset_dir, "valid", "_annotations.coco.json"),
        os.path.join(dataset_dir, "train", "_annotations.coco.json"),
    ]

    coco_path = None
    image_dir = dataset_dir
    for p in possible:
        if os.path.exists(p):
            coco_path = p
            image_dir = os.path.dirname(p)
            break

    if not coco_path:
        print(f"No _annotations.coco.json found in: {dataset_dir}")
        print("Expected Roboflow COCO export format: dataset/test/_annotations.coco.json")
        sys.exit(1)

    with open(coco_path) as f:
        data = json.load(f)

    images = data.get("images", [])
    annotations = data.get("annotations", [])
    categories = data.get("categories", [])

    return image_dir, images, annotations, categories


def normalize_name(name: str) -> str:
    """Lowercase, strip plural 's', remove special chars."""
    n = name.lower().strip()
    if n.endswith("s"):
        n = n[:-1]
    return "".join(c for c in n if c.isalpha() or c == " ").strip()


def matches_ground_truth(pred: str, gt_names: list[str]) -> bool:
    """Fuzzy match — substring or exact after normalization."""
    norm = normalize_name(pred)
    if not norm or len(norm) < 2:
        return False
    return any(
        norm == normalize_name(gt)
        or norm in normalize_name(gt)
        or normalize_name(gt) in norm
        for gt in gt_names
    )


def compute_metrics(predicted: list[str], ground_truth: list[str]):
    """Same metric computation as evaluate-vl.ts."""
    tp = [p for p in predicted if matches_ground_truth(p, ground_truth)]
    fp = [p for p in predicted if not matches_ground_truth(p, ground_truth)]
    fn = [g for g in ground_truth if not any(matches_ground_truth(p, [g]) for p in predicted)]

    precision = len(tp) / len(predicted) if predicted else 0.0
    recall = len(tp) / len(ground_truth) if ground_truth else 0.0
    f1 = 2 * precision * recall / (precision + recall) if (precision + recall) > 0 else 0.0

    return {
        "precision": precision,
        "recall": recall,
        "f1": f1,
        "false_positives": fp,
        "false_negatives": fn,
    }


def main():
    # Hardcoded defaults from project setup
    DEFAULT_MODEL = "/Volumes/DATA/VSCX/roboflow_test/best(1).pt"
    DEFAULT_DATASET = "/Volumes/DATA/VSCX/ReciPic/recipic/eval_dataset"

    parser = argparse.ArgumentParser(description="Evaluate YOLOv8 on Roboflow COCO dataset")
    parser.add_argument("model", nargs="?", default=DEFAULT_MODEL, help="Path to YOLOv8 .pt model file")
    parser.add_argument("dataset", nargs="?", default=DEFAULT_DATASET, help="Path to Roboflow dataset directory")
    parser.add_argument("--limit", type=int, default=50, help="Max images to evaluate")
    parser.add_argument("--conf", type=float, default=0.25, help="Confidence threshold")
    parser.add_argument("--device", default="mps", help="Device: mps, cpu, cuda")
    args = parser.parse_args()

    if not os.path.exists(args.model):
        print(f"Model not found: {args.model}")
        sys.exit(1)

    # ── Load dataset ──────────────────────────────────────────────
    image_dir, images, annotations, categories = load_coco_dataset(args.dataset)

    cat_map = {c["id"]: c["name"] for c in categories}

    # Build ground truth: image_id → unique class names
    gt_map = {}
    for ann in annotations:
        img_id = ann["image_id"]
        cat_name = cat_map.get(ann["category_id"])
        if not cat_name:
            continue
        gt_map.setdefault(img_id, [])
        if cat_name not in gt_map[img_id]:
            gt_map[img_id].append(cat_name)

    eval_images = [img for img in images if img["id"] in gt_map][: args.limit]

    if not eval_images:
        print("No annotated images found.")
        sys.exit(1)

    print(f"\n{'='*70}")
    print(f"YOLOv8 EVALUATION")
    print(f"{'='*70}")
    print(f"Model:      {args.model}")
    print(f"Dataset:    {args.dataset}")
    print(f"Images:     {len(eval_images)}")
    print(f"Categories: {len(categories)}")
    print(f"Conf:       {args.conf}")
    print(f"Device:     {args.device}")
    print()

    # ── Load model ────────────────────────────────────────────────
    print("Loading YOLOv8 model...")
    model = YOLO(args.model)
    # Get model's class names
    model_names = list(model.names.values()) if model.names else []

    # ── Evaluate ──────────────────────────────────────────────────
    print(f"{'Image':<40} {'GT':>4} {'Pred':>4} {'P':>6} {'R':>6} {'F1':>6} {'Time':>8}")
    print("-" * 80)

    results = []
    total_time = 0.0

    for idx, img_info in enumerate(eval_images):
        img_path = os.path.join(image_dir, img_info["file_name"])
        if not os.path.exists(img_path):
            print(f"  [{idx+1}/{len(eval_images)}] MISSING: {img_info['file_name']}")
            continue

        gt_names = gt_map.get(img_info["id"], [])

        # Run YOLOv8 inference
        t0 = time.time()
        predictions = model.predict(
            img_path,
            conf=args.conf,
            verbose=False,
            device=args.device,
        )
        elapsed_ms = (time.time() - t0) * 1000
        total_time += elapsed_ms

        # Extract detected class names (unique, above confidence threshold)
        pred_names = []
        for pred in predictions:
            if pred.boxes is not None and len(pred.boxes) > 0:
                for cls_id in pred.boxes.cls.tolist():
                    cls_id = int(cls_id)
                    name = model_names[cls_id] if cls_id < len(model_names) else str(cls_id)
                    if name not in pred_names:
                        pred_names.append(name)

        metrics = compute_metrics(pred_names, gt_names)

        line = (
            f"{img_info['file_name'][:38]:<40} "
            f"{len(gt_names):>4} "
            f"{len(pred_names):>4} "
            f"{metrics['precision']:>5.2f} "
            f"{metrics['recall']:>5.2f} "
            f"{metrics['f1']:>5.2f} "
            f"{elapsed_ms:>7.0f}ms"
        )
        print(line)

        if metrics["false_positives"]:
            print(f"  FP: {', '.join(metrics['false_positives'])}")
        if metrics["false_negatives"]:
            print(f"  FN: {', '.join(metrics['false_negatives'])}")

        results.append({
            "image": img_info["file_name"],
            "ground_truth": gt_names,
            "predicted": pred_names,
            **metrics,
            "time_ms": elapsed_ms,
        })

    # ── Aggregate ─────────────────────────────────────────────────
    if not results:
        print("\nNo results to aggregate.")
        return

    avg_precision = sum(r["precision"] for r in results) / len(results)
    avg_recall = sum(r["recall"] for r in results) / len(results)
    avg_f1 = sum(r["f1"] for r in results) / len(results)
    avg_time = total_time / len(results)

    print(f"\n{'='*70}")
    print("AGGREGATE RESULTS")
    print(f"{'='*70}")
    print(f"Images evaluated:  {len(results)}")
    print(f"Avg Precision:     {avg_precision * 100:.1f}%")
    print(f"Avg Recall:        {avg_recall * 100:.1f}%")
    print(f"Avg F1 Score:      {avg_f1 * 100:.1f}%")
    print(f"Avg Inference:     {avg_time:.0f}ms")
    print(f"Total Time:        {total_time / 1000:.1f}s")

    # Per-class
    class_stats = {}
    for r in results:
        for gt in r["ground_truth"]:
            s = class_stats.setdefault(gt, {"gt": 0, "pred": 0, "tp": 0})
            s["gt"] += 1
        for pred in r["predicted"]:
            s = class_stats.setdefault(pred, {"gt": 0, "pred": 0, "tp": 0})
            s["pred"] += 1
        for pred in r["predicted"]:
            if matches_ground_truth(pred, r["ground_truth"]):
                class_stats.setdefault(pred, {"gt": 0, "pred": 0, "tp": 0})["tp"] += 1

    print(f"\n{'Class':<25} {'GT':>4} {'Pred':>4} {'P':>7} {'R':>7} {'F1':>7}")
    print("-" * 60)
    for cls, stats in sorted(class_stats.items(), key=lambda x: -x[1]["gt"]):
        p = stats["tp"] / stats["pred"] if stats["pred"] > 0 else 0.0
        r = stats["tp"] / stats["gt"] if stats["gt"] > 0 else 0.0
        f = 2 * p * r / (p + r) if (p + r) > 0 else 0.0
        print(f"{cls[:23]:<25} {stats['gt']:>4} {stats['pred']:>4} {p:>6.2f} {r:>6.2f} {f:>6.2f}")

    # ── Comparison table placeholder ───────────────────────────────
    print(f"\n{'='*70}")
    print("COMPARISON: YOLOv8 vs VL Model")
    print(f"{'='*70}")
    print(f"{'Metric':<20} {'YOLOv8':>10} {'VL Model':>12}")
    print("-" * 45)
    print(f"{'Precision':<20} {avg_precision*100:>9.1f}%   {'___%':>8}")
    print(f"{'Recall':<20} {avg_recall*100:>9.1f}%   {'___%':>8}")
    print(f"{'F1 Score':<20} {avg_f1*100:>9.1f}%   {'___%':>8}")
    print(f"{'Avg Time':<20} {avg_time:>8.0f}ms   {'___ms':>8}")
    print()
    print("Note: Both evaluated on name-level precision/recall (no bounding boxes).")
    print("      Fill in VL Model column from: npx tsx scripts/evaluate-vl.ts")
    print()


if __name__ == "__main__":
    main()
