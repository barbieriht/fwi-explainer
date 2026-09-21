"""Build the classical-vs-deep-learning comparison shown in the deep-learning section of index.html.

For each case (the held-out test model with the most velocity variation, and a
hand-made model unlike anything in the training set) it runs:
  - classical FWI: gradient-based optimization of the velocity model through
    the differentiable simulator, from a smooth 1D starting model (the mean
    depth profile of the training models, independent of the case), with a
    low-to-high frequency schedule (low-pass filtered data first), and
  - the trained network: a single forward pass on the same data.
It also reports the network's mean error over the whole test set.
It writes PNGs (site colormap) to assets/img/dl/ and metrics to
assets/data/dl-comparison.json.

    python3 compare.py --data ../../data-src/dl
"""
from __future__ import annotations

import argparse
import json
import time
from pathlib import Path

import numpy as np
import torch
from PIL import Image

import common as c
from train import DataToModelNet

ROOT = Path(__file__).resolve().parents[2]
IMG_DIR = ROOT / "assets" / "img" / "dl"
METRICS_FILE = ROOT / "assets" / "data" / "dl-comparison.json"
# Script twin of the JSON so pages opened from file:// can read it (fetch() is blocked there).
METRICS_SCRIPT = ROOT / "assets" / "data" / "dl-comparison.js"
# Must match VELOCITY_STOPS in assets/js/colormap.js
VELOCITY_STOPS = np.array([[243, 231, 196], [86, 152, 163], [37, 52, 94]], dtype=float)
IMAGE_PX = 256
# (low-pass cutoff in Hz or None for the full band, Adam iterations)
FWI_SCHEDULE = ((5.0, 60), (8.0, 60), (None, 60))
FWI_LEARNING_RATE = 25.0  # m/s per Adam step
TIMING_REPEATS = 20


def parse_args() -> argparse.Namespace:
    p = argparse.ArgumentParser(description=__doc__)
    p.add_argument("--data", type=Path, required=True)
    return p.parse_args()


def to_rgb(model: np.ndarray) -> np.ndarray:
    t = np.clip((model - c.VMIN) / (c.VMAX - c.VMIN), 0, 1)
    seg = (t >= 0.5).astype(int)
    u = np.where(t < 0.5, t * 2, (t - 0.5) * 2)
    lo, hi = VELOCITY_STOPS[seg], VELOCITY_STOPS[seg + 1]
    return (lo + (hi - lo) * u[..., None]).astype(np.uint8)


def save_png(model: np.ndarray, path: Path) -> None:
    Image.fromarray(to_rgb(model)).resize((IMAGE_PX, IMAGE_PX), Image.NEAREST).save(path, optimize=True)


def out_of_distribution_model() -> np.ndarray:
    """Steep, strongly curved layers with a slow lens: features the generator never produces."""
    x = np.arange(c.NX)[None, :]
    z = np.arange(c.NZ)[:, None]
    model = np.full((c.NZ, c.NX), 1900.0)
    model = np.where(z > 18 + 0.8 * (x - 32) * np.sin(x / 9), 2900.0, model)
    model = np.where(z > 44 - 0.5 * np.abs(x - 32), 3800.0, model)
    lens = ((x - 40) / 10) ** 2 + ((z - 30) / 4) ** 2 < 1
    return np.where(lens, 1600.0, model).astype(np.float32)


def starting_model(train_models: np.ndarray) -> np.ndarray:
    profile = train_models.astype(np.float32).mean(axis=(0, 2))  # mean velocity per depth
    return np.repeat(profile[:, None], c.NX, axis=1)


def lowpass(traces: torch.Tensor, cutoff_hz):
    """Zero-phase low-pass along time with a cosine taper over the last 2 Hz."""
    if cutoff_hz is None:
        return traces
    n = traces.shape[2]
    freqs = torch.fft.rfftfreq(n, d=c.DT * c.TIME_DECIMATION).to(traces.device)
    taper = torch.clamp((cutoff_hz - freqs) / 2.0, 0, 1)
    gain = 0.5 - 0.5 * torch.cos(torch.pi * taper)
    spectrum = torch.fft.rfft(traces, dim=2) * gain.view(1, 1, -1, 1)
    return torch.fft.irfft(spectrum, n=n, dim=2)


def classical_fwi(observed: torch.Tensor, start: np.ndarray, wavelet: torch.Tensor):
    velocity = torch.tensor(start[None], device=observed.device, requires_grad=True)
    optimizer = torch.optim.Adam([velocity], lr=FWI_LEARNING_RATE)
    iterations = 0
    for cutoff, steps in FWI_SCHEDULE:
        target = lowpass(observed, cutoff)
        for it in range(steps):
            optimizer.zero_grad(set_to_none=True)
            loss = 0.5 * ((lowpass(c.simulate(velocity, wavelet), cutoff) - target) ** 2).sum()
            loss.backward()
            optimizer.step()
            with torch.no_grad():
                velocity.clamp_(c.VMIN, c.VMAX)
            iterations += 1
            if it % 20 == 0:
                print(f"  FWI band {cutoff or 'full'} iteration {it:3d}  misfit {float(loss):.4e}", flush=True)
    return velocity.detach()[0].cpu().numpy(), iterations


def mae(a: np.ndarray, b: np.ndarray) -> float:
    return float(np.abs(a - b).mean())


def most_structured(models: np.ndarray) -> int:
    """Index of the test model with the largest velocity standard deviation
    (a fixed rule, so the showcased example is not picked by result)."""
    return int(np.argmax(models.astype(np.float32).std(axis=(1, 2))))


@torch.no_grad()
def network_forward_seconds(net, data: torch.Tensor) -> float:
    net(data)  # warm-up (cuDNN autotuning, kernel loading)
    torch.cuda.synchronize()
    t0 = time.time()
    for _ in range(TIMING_REPEATS):
        net(data)
    torch.cuda.synchronize()
    return (time.time() - t0) / TIMING_REPEATS


@torch.no_grad()
def test_set_mae(net, folder: Path, device) -> float:
    data = torch.tensor(np.load(folder / "test_data.npy"), device=device).float()
    truth = torch.tensor(np.load(folder / "test_models.npy").astype(np.float32), device=device)
    pred = c.denormalize_velocity(torch.cat([net(data[i:i + 50]) for i in range(0, len(data), 50)]))
    return float((pred - truth).abs().mean())


def run_case(name, truth, net, start, wavelet, data_scale, device):
    print(f"case {name}", flush=True)
    with torch.no_grad():
        observed = c.simulate(torch.tensor(truth[None], device=device), wavelet)

    t0 = time.time()
    fwi_model, iterations = classical_fwi(observed, start, wavelet)
    torch.cuda.synchronize()
    fwi_seconds = time.time() - t0

    net_input = (observed * data_scale).half().float()  # same quantization as the training data
    with torch.no_grad():
        dl_model = c.denormalize_velocity(net(net_input))[0].cpu().numpy()
    dl_seconds = network_forward_seconds(net, net_input)

    for label, model in (("true", truth), ("start", start), ("fwi", fwi_model), ("dl", dl_model)):
        save_png(model, IMG_DIR / f"{name}-{label}.png")
    return {
        "mae_mps": {"start": mae(start, truth), "fwi": mae(fwi_model, truth), "dl": mae(dl_model, truth)},
        "seconds": {"fwi": round(fwi_seconds, 1), "dl": round(dl_seconds, 4)},
        "fwi_iterations": iterations,
    }


def main() -> None:
    args = parse_args()
    device = torch.device("cuda")
    IMG_DIR.mkdir(parents=True, exist_ok=True)
    meta = json.loads((args.data / "meta.json").read_text())
    wavelet = torch.tensor(c.ricker(c.F0, c.DT, c.NT), device=device)

    net = DataToModelNet().to(device)
    net.load_state_dict(torch.load(args.data / "model.pt", map_location=device))
    net.eval()
    start = starting_model(np.load(args.data / "train_models.npy"))
    test_models = np.load(args.data / "test_models.npy")
    test_index = most_structured(test_models)
    test_truth = test_models[test_index].astype(np.float32)

    cases = {
        "in-distribution": test_truth,
        "out-of-distribution": out_of_distribution_model(),
    }
    results = {
        name: run_case(name, truth, net, start, wavelet, meta["data_scale"], device)
        for name, truth in cases.items()
    }
    payload = json.dumps({
        "_about": "Generated by scripts/dl/compare.py. Mean absolute velocity error (m/s) against the true model.",
        "velocity_range_mps": [c.VMIN, c.VMAX],
        "grid": {"nx": c.NX, "nz": c.NZ, "dx_m": c.DX},
        "f0_hz": c.F0,
        "shots": len(c.SOURCE_X),
        "train_size": int(np.load(args.data / "train_models.npy", mmap_mode="r").shape[0]),
        "test_size": int(len(test_models)),
        "test_index": test_index,
        "dl_test_set_mae_mps": round(test_set_mae(net, args.data, device), 1),
        "fwi_schedule": [{"lowpass_hz": f, "iterations": n} for f, n in FWI_SCHEDULE],
        "cases": results,
    }, indent=2)
    METRICS_FILE.write_text(payload + "\n")
    METRICS_SCRIPT.write_text(
        "/* Generated by scripts/dl/compare.py from dl-comparison.json; do not edit. */\n"
        "window.FWI_DATA = window.FWI_DATA || {};\n"
        "window.FWI_DATA.dlComparison = " + payload + ";\n"
    )
    print(json.dumps(results, indent=2))


if __name__ == "__main__":
    main()
