"""Generate the synthetic training set: random velocity models and their
surface shot gathers, simulated on the GPU.

    python3 generate_dataset.py --out ../../data-src/dl
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
    return p.parse_args()


def main() -> None:
    args = parse_args()
    if not torch.cuda.is_available():
        raise SystemExit("CUDA GPU required (CPU would take hours).")
    device = torch.device("cuda")
    args.out.mkdir(parents=True, exist_ok=True)
    rng = np.random.default_rng(args.seed)
    wavelet = torch.tensor(c.ricker(c.F0, c.DT, c.NT), device=device)
    data_scale = None

    for name, size in SPLITS:
        n = max(1, int(size * args.scale_train))
        models = np.stack([c.random_model(rng) for _ in range(n)])
        data = np.empty((n, len(c.SOURCE_X), c.NT // c.TIME_DECIMATION, len(c.RECEIVER_X)), dtype=np.float16)
        start = time.time()
        for i in range(0, n, args.batch):
            v = torch.tensor(models[i:i + args.batch], device=device)
            with torch.no_grad():
                d = c.simulate(v, wavelet)
            if data_scale is None:  # fixed global scale so values fit float16 comfortably
                data_scale = float(1.0 / d.abs().max())
            data[i:i + len(v)] = (d * data_scale).cpu().numpy().astype(np.float16)
            print(f"{name}: {min(i + args.batch, n)}/{n} ({time.time() - start:.0f}s)", flush=True)
        np.save(args.out / f"{name}_models.npy", models.astype(np.float16))
        np.save(args.out / f"{name}_data.npy", data)

    (args.out / "meta.json").write_text(json.dumps({
        "data_scale": data_scale, "nx": c.NX, "nz": c.NZ, "dx": c.DX, "dt": c.DT, "nt": c.NT,
        "time_decimation": c.TIME_DECIMATION, "f0": c.F0, "source_x": c.SOURCE_X, "seed": args.seed,
    }, indent=2))


if __name__ == "__main__":
    main()
