/*
 * 2D constant-density acoustic wave solver (finite-difference time domain).
 *
 *   d2p/dt2 = v(x,z)^2 * laplacian(p) + s(x,z,t)
 *
 * Second order in time, fourth order in space, with a Cerjan-style sponge
 * layer padded around the user model to absorb outgoing waves. Adapted from
 * standard FDTD formulations.
 *
 * Grid indexing is row-major: index = iz * nx + ix (z grows downward).
 * Loaded as a classic script (window.FWI.solver) and as a CommonJS module
 * (Node tests), so the site works when opened straight from disk.
 */
(function (root) {
  'use strict';

  // Fourth-order central difference weights for the second derivative.
  const C0 = -5 / 2;
  const C1 = 4 / 3;
  const C2 = -1 / 12;
  const HALO = 2; // cells each stencil reaches past the centre

  // 2D stability limit for this stencil is sqrt(3/8) ~ 0.61; stay below it.
  const DEFAULT_COURANT = 0.45;
  const DEFAULT_SPONGE_CELLS = 32; // ~3% residual reflection at 10 Hz, 10 m cells
  // Per-step damping factor at the outermost sponge cell.
  const SPONGE_EDGE_FACTOR = 0.86;

  function ricker(f0, dt, nt, delay) {
    const t0 = delay === undefined ? 1.5 / f0 : delay;
    const w = new Float32Array(nt);
    for (let it = 0; it < nt; it++) {
      const a = Math.PI * f0 * (it * dt - t0);
      const a2 = a * a;
      w[it] = (1 - 2 * a2) * Math.exp(-a2);
    }
    return w;
  }

  function stableDt(vmax, dx, courant) {
    const c = courant === undefined ? DEFAULT_COURANT : courant;
    if (!(vmax > 0) || !(dx > 0)) throw new Error('vmax and dx must be positive');
    return (c * dx) / vmax;
  }

  function maxOf(arr) {
    let m = -Infinity;
    for (let i = 0; i < arr.length; i++) if (arr[i] > m) m = arr[i];
    return m;
  }

  function assertInside(point, nx, nz, label) {
    const ok = Number.isInteger(point.ix) && Number.isInteger(point.iz) &&
      point.ix >= 0 && point.ix < nx && point.iz >= 0 && point.iz < nz;
    if (!ok) throw new Error(label + ' (' + point.ix + ', ' + point.iz + ') is outside the grid');
  }

  function validate(opts) {
    const { nx, nz, dx, velocity, sources, receivers, nt } = opts;
    if (!Number.isInteger(nx) || !Number.isInteger(nz) || nx < 5 || nz < 5) {
      throw new Error('nx and nz must be integers >= 5');
    }
    if (!(dx > 0)) throw new Error('dx must be positive');
    if (!Number.isInteger(nt) || nt < 1) throw new Error('nt must be a positive integer');
    if (!velocity || velocity.length !== nx * nz) {
      throw new Error('velocity must have nx * nz = ' + nx * nz + ' values');
    }
    for (let i = 0; i < velocity.length; i++) {
      if (!(velocity[i] > 0)) throw new Error('velocity must be positive everywhere');
    }
    if (!Array.isArray(sources) || sources.length === 0) throw new Error('at least one source is required');
    sources.forEach(function (s, k) {
      assertInside(s, nx, nz, 'source ' + k);
      if (!s.wavelet || s.wavelet.length < nt) throw new Error('source ' + k + ' wavelet shorter than nt');
    });
    (receivers || []).forEach(function (r, k) { assertInside(r, nx, nz, 'receiver ' + k); });
  }

  // Copy the user model into the padded grid, extending edge values outward.
  function padVelocity(velocity, nx, nz, pad) {
    const px = nx + 2 * pad;
    const pz = nz + 2 * pad;
    const out = new Float32Array(px * pz);
    for (let jz = 0; jz < pz; jz++) {
      const iz = Math.min(nz - 1, Math.max(0, jz - pad));
      for (let jx = 0; jx < px; jx++) {
        const ix = Math.min(nx - 1, Math.max(0, jx - pad));
        out[jz * px + jx] = velocity[iz * nx + ix];
      }
    }
    return out;
  }

  function spongeProfile(px, pz, nb) {
    const alpha = Math.sqrt(-Math.log(SPONGE_EDGE_FACTOR));
    const g = new Float32Array(px * pz);
    for (let jz = 0; jz < pz; jz++) {
      const dz = Math.min(jz, pz - 1 - jz);
      for (let jx = 0; jx < px; jx++) {
        const d = Math.min(dz, jx, px - 1 - jx);
        const depth = d >= nb ? 0 : (nb - d) / nb;
        g[jz * px + jx] = Math.exp(-(alpha * depth) * (alpha * depth));
      }
    }
    return g;
  }

  /*
   * opts: { nx, nz, dx, dt?, nt, velocity: Float32Array(nx*nz),
   *         sources: [{ ix, iz, wavelet: Float32Array(>= nt) }],
   *         receivers?: [{ ix, iz }], spongeCells? }
   */
  function createSimulation(opts) {
    validate(opts);
    const nx = opts.nx;
    const nz = opts.nz;
    const dx = opts.dx;
    const nt = opts.nt;
    const dt = opts.dt === undefined ? stableDt(maxOf(opts.velocity), dx) : opts.dt;
    const nb = opts.spongeCells === undefined ? DEFAULT_SPONGE_CELLS : opts.spongeCells;
    const pad = nb + HALO;
    const px = nx + 2 * pad;
    const pz = nz + 2 * pad;

    const vpad = padVelocity(opts.velocity, nx, nz, pad);
    const courantMax = (maxOf(vpad) * dt) / dx;
    if (courantMax > Math.sqrt(3 / 8)) {
      throw new Error('dt violates the stability limit (Courant ' + courantMax.toFixed(3) + ')');
    }

    // (v * dt / dx)^2, precomputed per cell.
    const k = new Float32Array(px * pz);
    for (let i = 0; i < k.length; i++) {
      const c = (vpad[i] * dt) / dx;
      k[i] = c * c;
    }
    const sponge = spongeProfile(px, pz, nb);

    const sources = opts.sources.map(function (s) {
      return { index: (s.iz + pad) * px + (s.ix + pad), wavelet: s.wavelet };
    });
    const receivers = (opts.receivers || []).map(function (r) {
      return (r.iz + pad) * px + (r.ix + pad);
    });
    const nrec = receivers.length;

    let prev = new Float32Array(px * pz);
    let curr = new Float32Array(px * pz);
    let next = new Float32Array(px * pz);
    const seismogram = new Float32Array(nt * nrec); // row per time step
    let it = 0;

    function step() {
      if (it >= nt) return false;
      for (let jz = HALO; jz < pz - HALO; jz++) {
        const row = jz * px;
        for (let jx = HALO; jx < px - HALO; jx++) {
          const i = row + jx;
          const lap =
            2 * C0 * curr[i] +
            C1 * (curr[i - 1] + curr[i + 1] + curr[i - px] + curr[i + px]) +
            C2 * (curr[i - 2] + curr[i + 2] + curr[i - 2 * px] + curr[i + 2 * px]);
          next[i] = 2 * curr[i] - prev[i] + k[i] * lap;
        }
      }
      // Source term: dt^2 * v^2 * s / dx^2 keeps amplitude grid-independent.
      for (let s = 0; s < sources.length; s++) {
        const src = sources[s];
        next[src.index] += k[src.index] * src.wavelet[it];
      }
      for (let i = 0; i < next.length; i++) {
        next[i] *= sponge[i];
        curr[i] *= sponge[i];
      }
      const rotated = prev;
      prev = curr;
      curr = next;
      next = rotated;

      const base = it * nrec;
      for (let r = 0; r < nrec; r++) seismogram[base + r] = curr[receivers[r]];
      it++;
      return true;
    }

    // Copy the physical (unpadded) wavefield into `out` (length nx * nz).
    function readWavefield(out) {
      const target = out || new Float32Array(nx * nz);
      for (let iz = 0; iz < nz; iz++) {
        const src = (iz + pad) * px + pad;
        target.set(curr.subarray(src, src + nx), iz * nx);
      }
      return target;
    }

    return {
      nx: nx, nz: nz, nt: nt, dt: dt, dx: dx, nrec: nrec,
      seismogram: seismogram,
      step: step,
      readWavefield: readWavefield,
      get it() { return it; },
      get done() { return it >= nt; },
    };
  }

  const api = { createSimulation: createSimulation, ricker: ricker, stableDt: stableDt };

  if (typeof module !== 'undefined' && module.exports) {
    module.exports = api;
  } else {
    root.FWI = root.FWI || {};
    root.FWI.solver = api;
  }
})(typeof globalThis !== 'undefined' ? globalThis : this);
