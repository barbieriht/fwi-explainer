/*
 * Shared experiment for the Inverse Problem page: a crosswell survey (sources
 * down the left edge, receivers down the right edge) over a true model with a
 * fast circular anomaly. Transmission geometry makes arrival-time errors, and
 * therefore cycle-skipping, easy to see.
 */
(function (root) {
  'use strict';

  const FWI = root.FWI;
  if (!FWI || !FWI.solver || !FWI.inversion || !FWI.colormap) return;

  const N = 60;
  const DX = 10; // m
  const VMIN = 1500;
  const VMAX = 3000;
  const DT = FWI.solver.stableDt(VMAX, DX);
  const NT = Math.ceil(1.0 / DT);
  const SPONGE = 20;
  const SOURCE_COLUMN = 3;
  const RECEIVER_COLUMN = N - 4;
  const BACKGROUND = 2000;
  const ANOMALY = { ix: 30, iz: 30, radius: 10, velocity: 2400 };
  const LOW_HZ = 4;
  const HIGH_HZ = 12;
  const MASK_TAPER_CELLS = 4;

  const SHOTS = [];
  for (let iz = 5; iz < N; iz += 10) SHOTS.push({ ix: SOURCE_COLUMN, iz: iz });
  const RECEIVERS = [];
  for (let iz = 1; iz < N; iz += 2) RECEIVERS.push({ ix: RECEIVER_COLUMN, iz: iz });

  function homogeneous(v) {
    return new Float32Array(N * N).fill(v);
  }

  function trueModel() {
    const m = homogeneous(BACKGROUND);
    for (let iz = 0; iz < N; iz++) {
      for (let ix = 0; ix < N; ix++) {
        const d2 = (ix - ANOMALY.ix) * (ix - ANOMALY.ix) + (iz - ANOMALY.iz) * (iz - ANOMALY.iz);
        if (d2 < ANOMALY.radius * ANOMALY.radius) m[iz * N + ix] = ANOMALY.velocity;
      }
    }
    return m;
  }

  // Gradient taper: zero next to the source and receiver columns (where the
  // gradient is singular), ramping to one over a few cells.
  function gradientMask() {
    const mask = new Float32Array(N * N);
    for (let iz = 0; iz < N; iz++) {
      for (let ix = 0; ix < N; ix++) {
        const d = Math.min(ix - SOURCE_COLUMN, RECEIVER_COLUMN - ix) - 2;
        mask[iz * N + ix] = Math.min(1, Math.max(0, d / MASK_TAPER_CELLS));
      }
    }
    return mask;
  }

  function survey(f0, shots) {
    return FWI.inversion.createSurvey({
      nx: N, nz: N, dx: DX, dt: DT, nt: NT, f0: f0,
      shots: shots || SHOTS, receivers: RECEIVERS, spongeCells: SPONGE,
    });
  }

  // Draw a velocity model (with acquisition markers) onto a display canvas.
  function drawModel(canvas, model) {
    const size = canvas.width;
    const buffer = document.createElement('canvas');
    buffer.width = N;
    buffer.height = N;
    const bctx = buffer.getContext('2d');
    const image = bctx.createImageData(N, N);
    const rgb = FWI.colormap.velocityRgb(model, VMIN, VMAX);
    for (let i = 0; i < N * N; i++) {
      image.data[i * 4] = rgb[i * 3];
      image.data[i * 4 + 1] = rgb[i * 3 + 1];
      image.data[i * 4 + 2] = rgb[i * 3 + 2];
      image.data[i * 4 + 3] = 255;
    }
    bctx.putImageData(image, 0, 0);
    const ctx = canvas.getContext('2d');
    ctx.imageSmoothingEnabled = true;
    ctx.drawImage(buffer, 0, 0, size, size);

    const cell = size / N;
    ctx.fillStyle = '#e8a33d';
    ctx.strokeStyle = '#1c1f24';
    SHOTS.forEach(function (s) {
      const x = (s.ix + 0.5) * cell;
      const y = (s.iz + 0.5) * cell;
      ctx.beginPath();
      ctx.moveTo(x + 7, y);
      ctx.lineTo(x - 5, y - 6);
      ctx.lineTo(x - 5, y + 6);
      ctx.closePath();
      ctx.fill();
      ctx.stroke();
    });
    ctx.fillStyle = '#1c1f24';
    RECEIVERS.forEach(function (r) {
      ctx.fillRect((r.ix + 0.5) * cell - 2, (r.iz + 0.5) * cell - 2, 4, 4);
    });
  }

  FWI.inverseSetup = {
    N: N, DX: DX, DT: DT, NT: NT, VMIN: VMIN, VMAX: VMAX,
    BACKGROUND: BACKGROUND, LOW_HZ: LOW_HZ, HIGH_HZ: HIGH_HZ,
    SHOTS: SHOTS, RECEIVERS: RECEIVERS,
    homogeneous: homogeneous, trueModel: trueModel, gradientMask: gradientMask,
    survey: survey, drawModel: drawModel,
  };
})(globalThis);
