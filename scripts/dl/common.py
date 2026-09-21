"""Shared pieces of the offline deep-learning experiment.

The finite-difference scheme mirrors assets/js/solver.js (second order in
time, fourth order in space, Cerjan-style sponge), batched on the GPU with
PyTorch so thousands of shots can be simulated quickly.
"""
from __future__ import annotations

import math
from dataclasses import dataclass

import numpy as np
import torch

# ---------------------------------------------------------------- experiment

NX = NZ = 64
DX = 10.0  # m
VMIN, VMAX = 1500.0, 4500.0  # m/s
F0 = 12.0  # Hz
RECORD_SECONDS = 1.0
COURANT = 0.45
DT = COURANT * DX / VMAX
NT = math.ceil(RECORD_SECONDS / DT)
TIME_DECIMATION = 4  # samples kept for the network: NT / 4
SPONGE_CELLS = 20
SPONGE_EDGE_FACTOR = 0.86
HALO = 2
SOURCE_DEPTH = 1
RECEIVER_DEPTH = 1
SOURCE_X = (4, 18, 32, 46, 60)
RECEIVER_X = tuple(range(NX))

C0, C1, C2 = -5.0 / 2.0, 4.0 / 3.0, -1.0 / 12.0


def ricker(f0: float, dt: float, nt: int) -> np.ndarray:
    t = np.arange(nt) * dt - 1.5 / f0
    a2 = (math.pi * f0 * t) ** 2
    return ((1 - 2 * a2) * np.exp(-a2)).astype(np.float32)


@dataclass(frozen=True)
class Grid:
    pad: int
    pz: int
    px: int


def grid() -> Grid:
    pad = SPONGE_CELLS + HALO
    return Grid(pad=pad, pz=NZ + 2 * pad, px=NX + 2 * pad)


def sponge(device: torch.device) -> torch.Tensor:
    g = grid()
    alpha = math.sqrt(-math.log(SPONGE_EDGE_FACTOR))
    jz = torch.arange(g.pz, device=device).view(-1, 1)
    jx = torch.arange(g.px, device=device).view(1, -1)
    d = torch.minimum(torch.minimum(jz, g.pz - 1 - jz), torch.minimum(jx, g.px - 1 - jx))
    depth = torch.clamp((SPONGE_CELLS - d) / SPONGE_CELLS, min=0)
    return torch.exp(-(alpha * depth) ** 2).float()


def pad_velocity(v: torch.Tensor) -> torch.Tensor:
    """(B, NZ, NX) -> (B, PZ, PX), extending edge values outward."""
    pad = grid().pad
    return torch.nn.functional.pad(v.unsqueeze(1), (pad, pad, pad, pad), mode="replicate").squeeze(1)


def laplacian_dx2(p: torch.Tensor) -> torch.Tensor:
    """Fourth-order discrete Laplacian times dx^2 on the interior (zero on the halo)."""
    out = torch.zeros_like(p)
    c = p[..., 2:-2, 2:-2]
    out[..., 2:-2, 2:-2] = (
        2 * C0 * c
        + C1 * (p[..., 2:-2, 1:-3] + p[..., 2:-2, 3:-1] + p[..., 1:-3, 2:-2] + p[..., 3:-1, 2:-2])
        + C2 * (p[..., 2:-2, :-4] + p[..., 2:-2, 4:] + p[..., :-4, 2:-2] + p[..., 4:, 2:-2])
    )
    return out


def simulate(velocity: torch.Tensor, wavelet: torch.Tensor, decimate: int = TIME_DECIMATION) -> torch.Tensor:
    """Surface shot gathers for a batch of models.

    velocity: (B, NZ, NX) m/s on the target device.
    Returns (B, n_shots, NT // decimate, n_receivers). Differentiable w.r.t.
    velocity, so the same routine serves the classical (autograd) FWI baseline.
    """
    g = grid()
    device = velocity.device
    b = velocity.shape[0]
    ns = len(SOURCE_X)
    k = (pad_velocity(velocity) * DT / DX) ** 2  # (B, PZ, PX)
    k = k.unsqueeze(1)  # broadcast over shots
    damp = sponge(device)

    src_z = SOURCE_DEPTH + g.pad
    src_x = torch.tensor(SOURCE_X, device=device) + g.pad
    shot_idx = torch.arange(ns, device=device)
    rec_z = RECEIVER_DEPTH + g.pad
    rec_x = torch.tensor(RECEIVER_X, device=device) + g.pad

    prev = torch.zeros(b, ns, g.pz, g.px, device=device)
    curr = torch.zeros_like(prev)
    k_src = k[:, 0, src_z, src_x]  # (B, ns)
    traces = []
    for it in range(NT):
        nxt = 2 * curr - prev + k * laplacian_dx2(curr)
        inject = torch.zeros_like(nxt)
        inject[:, shot_idx, src_z, src_x] = k_src * wavelet[it]
        nxt = (nxt + inject) * damp
        prev, curr = curr * damp, nxt
        if it % decimate == 0:
            traces.append(curr[:, :, rec_z, rec_x])
    return torch.stack(traces, dim=2)


# ------------------------------------------------------------ model generator

def random_model(rng: np.random.Generator) -> np.ndarray:
    """A synthetic 'geology-like' model: curved layers, an optional fault and
    an optional intrusion. Velocities mostly increase with depth."""
    x = np.arange(NX)[None, :]
    z = np.arange(NZ)[:, None]
    n_layers = rng.integers(3, 7)
    base_depths = np.sort(rng.uniform(6, NZ - 4, n_layers - 1))
    v_top = rng.uniform(VMIN, 2500)
    increments = rng.uniform(150, 700, n_layers - 1) * rng.choice([1, 1, 1, -0.5], n_layers - 1)
    velocities = np.clip(v_top + np.concatenate([[0], np.cumsum(increments)]), VMIN, VMAX)

    amplitude = rng.uniform(0, 6)
    wavelength = rng.uniform(30, 120)
    phase = rng.uniform(0, 2 * np.pi)
    tilt = rng.uniform(-0.15, 0.15)
    shift = np.zeros_like(x, dtype=float)
    if rng.random() < 0.4:  # normal fault: offset layers on one side of a dipping line
        x0, dip, throw = rng.uniform(15, 50), rng.uniform(-0.6, 0.6), rng.uniform(3, 10)
        shift = np.where(x > x0 + dip * z, throw, 0.0)

    model = np.full((NZ, NX), velocities[0], dtype=np.float32)
    for depth, v in zip(base_depths, velocities[1:]):
        interface = depth + amplitude * np.sin(2 * np.pi * x / wavelength + phase) + tilt * (x - NX / 2) + shift
        model = np.where(z >= interface, v, model)

    if rng.random() < 0.3:  # intrusion (salt-like body)
        cx, cz = rng.uniform(12, NX - 12), rng.uniform(20, NZ - 10)
        rx, rz = rng.uniform(4, 12), rng.uniform(3, 8)
        body = ((x - cx) / rx) ** 2 + ((z - cz) / rz) ** 2 < 1
        model = np.where(body, rng.uniform(3500, VMAX), model)
    return np.clip(model, VMIN, VMAX).astype(np.float32)


# Signed log compression of the (globally scaled) shot gathers: the direct wave
# dominates the raw amplitudes, so deep reflections are nearly invisible to a
# network without it. Maps [-1, 1] to [-1, 1]; applied on the fly, the stored
# dataset is unchanged.
COMPRESS_SCALE = 1e-3


def compress(data: torch.Tensor) -> torch.Tensor:
    return torch.sign(data) * torch.log1p(data.abs() / COMPRESS_SCALE) / math.log1p(1 / COMPRESS_SCALE)


def normalize_velocity(v):
    return (v - VMIN) / (VMAX - VMIN) * 2 - 1


def denormalize_velocity(v):
    return (v + 1) / 2 * (VMAX - VMIN) + VMIN
