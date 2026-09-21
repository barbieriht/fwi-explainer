'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const inv = require('../assets/js/inversion.js');
const { stableDt } = require('../assets/js/solver.js');

const N = 40;
const DX = 10;
const DT = stableDt(3000, DX);
const NT = Math.ceil(0.5 / DT);
const SHOTS = [5, 20, 35].map(function (iz) { return { ix: 3, iz: iz }; });
const RECEIVERS = [];
for (let iz = 1; iz < N; iz += 2) RECEIVERS.push({ ix: N - 4, iz: iz });

function survey() {
  return inv.createSurvey({ nx: N, nz: N, dx: DX, dt: DT, nt: NT, f0: 12, shots: SHOTS, receivers: RECEIVERS, spongeCells: 20 });
}

function trueModel() {
  const m = new Float32Array(N * N).fill(2000);
  for (let iz = 0; iz < N; iz++) {
    for (let ix = 0; ix < N; ix++) {
      if ((ix - 20) ** 2 + (iz - 20) ** 2 < 64) m[iz * N + ix] = 2400;
    }
  }
  return m;
}

test('createSurvey validates its inputs', () => {
  const base = { nx: N, nz: N, dx: DX, dt: DT, nt: NT, f0: 12, shots: SHOTS, receivers: RECEIVERS };
  assert.throws(() => inv.createSurvey({ ...base, shots: [] }), /shots/);
  assert.throws(() => inv.createSurvey({ ...base, receivers: [] }), /receivers/);
  assert.throws(() => inv.createSurvey({ ...base, f0: 0 }), /f0/);
});

test('misfit is zero for the true model', () => {
  const s = survey();
  const observed = inv.simulate(s, trueModel());
  assert.equal(inv.misfit(inv.simulate(s, trueModel()), observed), 0);
});

test('adjoint-state gradient matches finite differences', () => {
  const s = survey();
  const observed = inv.simulate(s, trueModel());
  const start = new Float32Array(N * N).fill(2000);
  const { gradient } = inv.gradient(s, start, observed);
  const h = 5; // m/s
  [[20, 20], [15, 22], [28, 10]].forEach(function ([ix, iz]) {
    const i = iz * N + ix;
    const plus = Float32Array.from(start);
    const minus = Float32Array.from(start);
    plus[i] += h;
    minus[i] -= h;
    const fd = (inv.misfit(inv.simulate(s, plus), observed) - inv.misfit(inv.simulate(s, minus), observed)) / (2 * h);
    const rel = Math.abs(gradient[i] - fd) / Math.abs(fd);
    assert.ok(rel < 0.01, 'cell (' + ix + ', ' + iz + '): adjoint ' + gradient[i] + ' vs FD ' + fd);
  });
});

test('inversion from the correct background reduces the misfit', () => {
  const s = survey();
  const observed = inv.simulate(s, trueModel());
  const run = inv.createInversion(s, observed, new Float32Array(N * N).fill(2000), { vmin: 1500, vmax: 3000 });
  for (let k = 0; k < 3; k++) run.step();
  const h = run.history;
  assert.ok(h[h.length - 1] < 0.5 * h[0], 'misfit ratio ' + (h[h.length - 1] / h[0]).toFixed(3));
  run.model.forEach(function (v) { assert.ok(v >= 1500 && v <= 3000); });
});
