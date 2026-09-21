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
    return p.parse_args()


def load_split(folder: Path, name: str, device: torch.device):
    data = torch.tensor(np.load(folder / f"{name}_data.npy"), device=device)  # float16
    models = torch.tensor(np.load(folder / f"{name}_models.npy").astype(np.float32), device=device)
    return data, c.normalize_velocity(models)


@torch.no_grad()
def evaluate(net: nn.Module, data: torch.Tensor, target: torch.Tensor, batch: int) -> float:
    """Mean absolute error in m/s."""
    net.eval()
    errors = []
    for i in range(0, len(data), batch):
        pred = net(data[i:i + batch].float())
        errors.append((c.denormalize_velocity(pred) - c.denormalize_velocity(target[i:i + batch])).abs().mean(dim=(1, 2)))
    return float(torch.cat(errors).mean())


def main() -> None:
    args = parse_args()
    torch.manual_seed(args.seed)
    device = torch.device("cuda" if torch.cuda.is_available() else "cpu")
    train_x, train_y = load_split(args.data, "train", device)
    val_x, val_y = load_split(args.data, "val", device)

    net = DataToModelNet().to(device)
    optimizer = torch.optim.AdamW(net.parameters(), lr=args.lr, weight_decay=1e-4)
    steps = args.epochs * (len(train_x) // args.batch)
    scheduler = torch.optim.lr_scheduler.OneCycleLR(optimizer, max_lr=args.lr, total_steps=steps)
    loss_fn = nn.L1Loss()
    print(f"parameters: {sum(p.numel() for p in net.parameters()) / 1e6:.2f} M", flush=True)

    log, best = [], float("inf")
    for epoch in range(args.epochs):
        net.train()
        start, total = time.time(), 0.0
        order = torch.randperm(len(train_x), device=device)
        for i in range(0, len(order) - args.batch + 1, args.batch):
            idx = order[i:i + args.batch]
            loss = loss_fn(net(train_x[idx].float()), train_y[idx])
            optimizer.zero_grad(set_to_none=True)
            loss.backward()
            optimizer.step()
            scheduler.step()
            total += loss.item()
        val_mae = evaluate(net, val_x, val_y, args.batch)
        log.append({"epoch": epoch + 1, "train_l1": total / (len(order) // args.batch), "val_mae_mps": val_mae})
        print(f"epoch {epoch + 1:3d}  train L1 {log[-1]['train_l1']:.4f}  val MAE {val_mae:6.1f} m/s  ({time.time() - start:.0f}s)", flush=True)
        if val_mae < best:
            best = val_mae
            torch.save(net.state_dict(), args.data / "model.pt")
    (args.data / "train_log.json").write_text(json.dumps(log, indent=2))
    print(f"best val MAE: {best:.1f} m/s", flush=True)


if __name__ == "__main__":
    main()
