/*
 * Shared experiment for the Inverse Problem page: a true model with a fast
 * circular anomaly and two acquisition geometries.
 *  - crosswell: sources down the left edge, receivers down the right edge.
 *    Transmission geometry makes arrival-time errors, and therefore
 *    cycle-skipping, easy to see.
 *  - surround: crosswell plus sources and receivers along the top and bottom,
 *    adding short source-receiver distances.
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
  const TOP_ROW = SOURCE_COLUMN;
  const BOTTOM_ROW = RECEIVER_COLUMN;

  function crosswell() {
    const shots = [];
    for (let iz = 5; iz < N; iz += 10) shots.push({ ix: SOURCE_COLUMN, iz: iz });
    const receivers = [];
    for (let iz = 1; iz < N; iz += 2) receivers.push({ ix: RECEIVER_COLUMN, iz: iz });
    return { shots: shots, receivers: receivers };
  }

  function surround() {
    const base = crosswell();
    const shots = base.shots.slice();
    [20, 40].forEach(function (ix) {
      shots.push({ ix: ix, iz: TOP_ROW });
      shots.push({ ix: ix, iz: BOTTOM_ROW });
    });
    const receivers = base.receivers.slice();
    for (let ix = 7; ix < RECEIVER_COLUMN - 2; ix += 3) {
      receivers.push({ ix: ix, iz: TOP_ROW });
      receivers.push({ ix: ix, iz: BOTTOM_ROW });
    }
    return { shots: shots, receivers: receivers };
  }

  const GEOMETRIES = Object.freeze({ crosswell: crosswell(), surround: surround() });

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


  function survey(f0, geometryName, shots) {
    const geometry = GEOMETRIES[geometryName];
    return FWI.inversion.createSurvey({
      nx: N, nz: N, dx: DX, dt: DT, nt: NT, f0: f0,
      shots: shots || geometry.shots, receivers: geometry.receivers, spongeCells: SPONGE,
    });
  }

  // Draw a velocity model (with acquisition markers) onto a display canvas.
  function drawModel(canvas, model, geometryName) {
    const geometry = GEOMETRIES[geometryName];
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
    geometry.shots.forEach(function (s) {
      const x = (s.ix + 0.5) * cell;
      const y = (s.iz + 0.5) * cell;
      ctx.beginPath();
      ctx.arc(x, y, 5, 0, 2 * Math.PI);
      ctx.fill();
      ctx.stroke();
    });
    // Dark squares with a light outline stay visible on slow and fast velocities.
    ctx.fillStyle = '#1c1f24';
    ctx.strokeStyle = 'rgba(255, 255, 255, 0.85)';
    ctx.lineWidth = 1;
    geometry.receivers.forEach(function (r) {
      ctx.fillRect((r.ix + 0.5) * cell - 2, (r.iz + 0.5) * cell - 2, 4, 4);
      ctx.strokeRect((r.ix + 0.5) * cell - 2.5, (r.iz + 0.5) * cell - 2.5, 5, 5);
    });
  }

  FWI.inverseSetup = {
    N: N, DX: DX, DT: DT, NT: NT, VMIN: VMIN, VMAX: VMAX,
    BACKGROUND: BACKGROUND, LOW_HZ: LOW_HZ, HIGH_HZ: HIGH_HZ,
    GEOMETRIES: GEOMETRIES,
    homogeneous: homogeneous, trueModel: trueModel,
    survey: survey, drawModel: drawModel,
  };
})(globalThis);
