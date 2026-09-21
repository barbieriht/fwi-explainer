"""Generate the synthetic training set: random velocity models and their
surface shot gathers, simulated on the GPU.

    python3 generate_dataset.py --out ../../data-src/dl
    python3 generate_dataset.py --out ../../data-src/dl --append 8000 --seed 7   # more training data
"""
from __future__ import annotations

import argparse
import json
import time
from pathlib import Path

import numpy as np
import torch

import common as c

SPLITS = (("train", 8000), ("val", 400), ("test", 200))


def parse_args() -> argparse.Namespace:
    p = argparse.ArgumentParser(description=__doc__)
    p.add_argument("--out", type=Path, required=True)
    p.add_argument("--batch", type=int, default=256)
    p.add_argument("--seed", type=int, default=2026)
    p.add_argument("--scale-train", type=float, default=1.0, help="fraction of the default split sizes")
    p.add_argument("--append", type=int, default=0,
                   help="add this many training samples to an existing dataset (use a new --seed)")
    return p.parse_args()


def simulate_split(models: np.ndarray, wavelet, device, batch: int, data_scale, name: str):
    """Shot gathers for `models`, scaled by `data_scale` (fixed from the first
    batch when None) and stored as float16. Returns (data, data_scale)."""
    n = len(models)
    data = np.empty((n, len(c.SOURCE_X), c.NT // c.TIME_DECIMATION, len(c.RECEIVER_X)), dtype=np.float16)
    start = time.time()
    for i in range(0, n, batch):
        v = torch.tensor(models[i:i + batch], device=device)
        with torch.no_grad():
            d = c.simulate(v, wavelet)
        if data_scale is None:  # fixed global scale so values fit float16 comfortably
            data_scale = float(1.0 / d.abs().max())
        data[i:i + len(v)] = (d * data_scale).cpu().numpy().astype(np.float16)
        print(f"{name}: {min(i + batch, n)}/{n} ({time.time() - start:.0f}s)", flush=True)
    return data, data_scale


def append_training(args, device, wavelet) -> None:
    """Grow the training split, reusing the existing amplitude scale so old and
    new samples are consistent. Files are merged through memory maps."""
    meta_path = args.out / "meta.json"
    meta = json.loads(meta_path.read_text())
    if args.seed in meta.get("seeds", [meta["seed"]]):
        raise SystemExit(f"seed {args.seed} was already used for this dataset; pick another")
    started = time.time()
    rng = np.random.default_rng(args.seed)
    models = np.stack([c.random_model(rng) for _ in range(args.append)])
    data, _ = simulate_split(models, wavelet, device, args.batch, meta["data_scale"], "append")
    for name, new in (("data", data), ("models", models.astype(np.float16))):
        path = args.out / f"train_{name}.npy"
        old = np.load(path, mmap_mode="r")
        merged_path = args.out / f"train_{name}.merged.npy"
        merged = np.lib.format.open_memmap(merged_path, mode="w+", dtype=old.dtype, shape=(len(old) + len(new),) + old.shape[1:])
        for i in range(0, len(old), 1000):
            merged[i:i + 1000] = old[i:i + 1000]
        merged[len(old):] = new
        merged.flush()
        del merged, old
        merged_path.replace(path)
    meta["seeds"] = meta.get("seeds", [meta["seed"]]) + [args.seed]
    meta["train_size"] = int(np.load(args.out / "train_models.npy", mmap_mode="r").shape[0])
    meta["generation_minutes"] = round(meta.get("generation_minutes", 0) + (time.time() - started) / 60, 1)
    meta_path.write_text(json.dumps(meta, indent=2))
    print(f"training split now has {meta['train_size']} samples")


def main() -> None:
    args = parse_args()
    if not torch.cuda.is_available():
        raise SystemExit("CUDA GPU required (CPU would take hours).")
    device = torch.device("cuda")
    args.out.mkdir(parents=True, exist_ok=True)
    wavelet = torch.tensor(c.ricker(c.F0, c.DT, c.NT), device=device)
    if args.append:
        append_training(args, device, wavelet)
        return
    rng = np.random.default_rng(args.seed)
    data_scale = None
    started = time.time()

    for name, size in SPLITS:
        n = max(1, int(size * args.scale_train))
        models = np.stack([c.random_model(rng) for _ in range(n)])
        data, data_scale = simulate_split(models, wavelet, device, args.batch, data_scale, name)
        np.save(args.out / f"{name}_models.npy", models.astype(np.float16))
        np.save(args.out / f"{name}_data.npy", data)

    (args.out / "meta.json").write_text(json.dumps({
        "data_scale": data_scale, "nx": c.NX, "nz": c.NZ, "dx": c.DX, "dt": c.DT, "nt": c.NT,
        "time_decimation": c.TIME_DECIMATION, "f0": c.F0, "source_x": c.SOURCE_X, "seed": args.seed,
        "seeds": [args.seed], "generation_minutes": round((time.time() - started) / 60, 1),
    }, indent=2))


if __name__ == "__main__":
    main()
