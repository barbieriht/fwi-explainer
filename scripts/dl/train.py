"""Train a small convolutional encoder-decoder that maps surface shot gathers
(5 shots x 250 samples x 64 receivers) directly to a 64 x 64 velocity model.

    python3 train.py --data ../../data-src/dl
"""
from __future__ import annotations

import argparse
import json
import time
from pathlib import Path

import numpy as np
import torch
from torch import nn

import common as c


def conv(cin: int, cout: int, kernel, stride) -> nn.Sequential:
    padding = tuple(k // 2 for k in kernel) if isinstance(kernel, tuple) else kernel // 2
    return nn.Sequential(nn.Conv2d(cin, cout, kernel, stride, padding), nn.BatchNorm2d(cout), nn.LeakyReLU(0.2))


def up(cin: int, cout: int) -> nn.Sequential:
    return nn.Sequential(
        nn.ConvTranspose2d(cin, cout, 4, 2, 1), nn.BatchNorm2d(cout), nn.LeakyReLU(0.2),
        conv(cout, cout, 3, 1),
    )


class DataToModelNet(nn.Module):
    """Encoder squeezes time and receivers into a latent vector; the decoder
    unfolds it into the velocity image."""

    def __init__(self, shots: int = len(c.SOURCE_X), latent: int = 512):
        super().__init__()
        self.encoder = nn.Sequential(
            conv(shots, 32, (7, 1), (2, 1)),    # 125 x 64
            conv(32, 64, (3, 1), (2, 1)),       # 63 x 64
            conv(64, 64, (3, 1), (2, 1)),       # 32 x 64
            conv(64, 128, 3, 2),                # 16 x 32
            conv(128, 128, 3, 1),
            conv(128, 256, 3, 2),               # 8 x 16
            conv(256, 256, 3, 2),               # 4 x 8
            nn.Conv2d(256, latent, (4, 8)),     # 1 x 1
            nn.LeakyReLU(0.2),
        )
        self.decoder = nn.Sequential(
            nn.ConvTranspose2d(latent, 256, 8), nn.BatchNorm2d(256), nn.LeakyReLU(0.2),  # 8 x 8
            up(256, 128),   # 16
            up(128, 64),    # 32
            up(64, 32),     # 64
            nn.Conv2d(32, 1, 3, 1, 1),
            nn.Tanh(),
        )

    def forward(self, data: torch.Tensor) -> torch.Tensor:
        return self.decoder(self.encoder(data)).squeeze(1)


def parse_args() -> argparse.Namespace:
    p = argparse.ArgumentParser(description=__doc__)
    p.add_argument("--data", type=Path, required=True)
    p.add_argument("--epochs", type=int, default=60)
    p.add_argument("--batch", type=int, default=64)
    p.add_argument("--lr", type=float, default=1e-3)
    p.add_argument("--seed", type=int, default=0)
    p.add_argument("--compress", action="store_true", help="signed-log compression of the input gathers")
    p.add_argument("--grad-loss", type=float, default=0.0, help="weight of the edge (gradient-difference) loss")
    p.add_argument("--ema", type=float, default=0.0, help="EMA decay for the evaluated weights (0 = off)")
    p.add_argument("--amp", action="store_true", help="mixed-precision training")
    p.add_argument("--out", default="model.pt", help="checkpoint name inside --data; a .json config sits next to it")
    p.add_argument("--tag", default="", help="label for the ablation log")
    p.add_argument("--limit", type=int, default=0, help="use only the first N training samples (0 = all)")
    return p.parse_args()


LOAD_CHUNK = 1000  # samples copied to the GPU at a time, to keep host RAM low


def load_split(folder: Path, name: str, device: torch.device, limit: int = 0):
    """Memory-maps the split and copies it to the device in chunks, so a
    multi-GB dataset never needs a second full copy in host RAM."""
    raw_data = np.load(folder / f"{name}_data.npy", mmap_mode="r")
    raw_models = np.load(folder / f"{name}_models.npy", mmap_mode="r")
    n = min(limit, len(raw_data)) if limit else len(raw_data)
    data = torch.empty((n,) + raw_data.shape[1:], dtype=torch.float16, device=device)
    models = torch.empty((n,) + raw_models.shape[1:], dtype=torch.float32, device=device)
    for i in range(0, n, LOAD_CHUNK):
        j = min(i + LOAD_CHUNK, n)
        data[i:j] = torch.from_numpy(np.ascontiguousarray(raw_data[i:j]))
        models[i:j] = torch.from_numpy(np.ascontiguousarray(raw_models[i:j]).astype(np.float32))
    return data, c.normalize_velocity(models)


def prepare(data: torch.Tensor, compress: bool) -> torch.Tensor:
    x = data.float()
    return c.compress(x) if compress else x


def gradient_loss(pred: torch.Tensor, target: torch.Tensor) -> torch.Tensor:
    """L1 between vertical and horizontal finite differences: rewards sharp,
    correctly placed interfaces rather than smooth averages."""
    dz = lambda v: v[:, 1:, :] - v[:, :-1, :]
    dx = lambda v: v[:, :, 1:] - v[:, :, :-1]
    return (dz(pred) - dz(target)).abs().mean() + (dx(pred) - dx(target)).abs().mean()


@torch.no_grad()
def evaluate(net: nn.Module, data: torch.Tensor, target: torch.Tensor, batch: int, compress: bool) -> float:
    """Mean absolute error in m/s."""
    net.eval()
    errors = []
    for i in range(0, len(data), batch):
        pred = net(prepare(data[i:i + batch], compress))
        errors.append((c.denormalize_velocity(pred) - c.denormalize_velocity(target[i:i + batch])).abs().mean(dim=(1, 2)))
    return float(torch.cat(errors).mean())


def log_ablation(folder: Path, entry: dict) -> None:
    path = folder / "ablations.json"
    runs = json.loads(path.read_text()) if path.exists() else []
    path.write_text(json.dumps(runs + [entry], indent=2))


def main() -> None:
    args = parse_args()
    torch.manual_seed(args.seed)
    device = torch.device("cuda" if torch.cuda.is_available() else "cpu")
    train_x, train_y = load_split(args.data, "train", device, args.limit)
    val_x, val_y = load_split(args.data, "val", device)

    net = DataToModelNet().to(device)
    ema = (torch.optim.swa_utils.AveragedModel(
        net, multi_avg_fn=torch.optim.swa_utils.get_ema_multi_avg_fn(args.ema), use_buffers=True)
        if args.ema > 0 else None)
    optimizer = torch.optim.AdamW(net.parameters(), lr=args.lr, weight_decay=1e-4)
    steps = args.epochs * (len(train_x) // args.batch)
    scheduler = torch.optim.lr_scheduler.OneCycleLR(optimizer, max_lr=args.lr, total_steps=steps)
    scaler = torch.amp.GradScaler("cuda", enabled=args.amp)
    l1 = nn.L1Loss()
    print(f"parameters: {sum(p.numel() for p in net.parameters()) / 1e6:.2f} M, train samples: {len(train_x)}", flush=True)

    log, best, started = [], float("inf"), time.time()
    for epoch in range(args.epochs):
        net.train()
        start, total = time.time(), 0.0
        order = torch.randperm(len(train_x), device=device)
        for i in range(0, len(order) - args.batch + 1, args.batch):
            idx = order[i:i + args.batch]
            with torch.autocast("cuda", dtype=torch.float16, enabled=args.amp):
                pred = net(prepare(train_x[idx], args.compress))
            pred = pred.float()
            loss = l1(pred, train_y[idx])
            if args.grad_loss > 0:
                loss = loss + args.grad_loss * gradient_loss(pred, train_y[idx])
            optimizer.zero_grad(set_to_none=True)
            scaler.scale(loss).backward()
            scaler.step(optimizer)
            scaler.update()
            scheduler.step()
            if ema is not None:
                ema.update_parameters(net)
            total += loss.item()
        evaluated = ema.module if ema is not None else net
        val_mae = evaluate(evaluated, val_x, val_y, args.batch, args.compress)
        log.append({"epoch": epoch + 1, "train_loss": total / (len(order) // args.batch), "val_mae_mps": val_mae})
        print(f"epoch {epoch + 1:3d}  train loss {log[-1]['train_loss']:.4f}  val MAE {val_mae:6.1f} m/s  ({time.time() - start:.0f}s)", flush=True)
        if val_mae < best:
            best = val_mae
            torch.save(evaluated.state_dict(), args.data / args.out)

    minutes = (time.time() - started) / 60
    config = {"compress": args.compress, "grad_loss": args.grad_loss, "ema": args.ema, "amp": args.amp,
              "epochs": args.epochs, "train_size": int(len(train_x)), "best_val_mae_mps": round(best, 1),
              "train_minutes": round(minutes, 1)}
    (args.data / (Path(args.out).stem + ".json")).write_text(json.dumps(config, indent=2))
    (args.data / (Path(args.out).stem + "_log.json")).write_text(json.dumps(log, indent=2))
    log_ablation(args.data, {"tag": args.tag or args.out, **config})
    print(f"best val MAE: {best:.1f} m/s  ({minutes:.1f} min)", flush=True)


if __name__ == "__main__":
    main()
