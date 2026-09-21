'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { createSimulation, ricker, stableDt } = require('../assets/js/solver.js');

const NX = 120;
const NZ = 120;
const DX = 10; // m
const V = 2000; // m/s
const F0 = 10; // Hz

function homogeneous(v) {
  return new Float32Array(NX * NZ).fill(v);
}

function centeredShot(nt, receivers) {
  const dt = stableDt(V, DX);
  return createSimulation({
    nx: NX, nz: NZ, dx: DX, dt: dt, nt: nt,
    velocity: homogeneous(V),
    sources: [{ ix: 60, iz: 60, wavelet: ricker(F0, dt, nt) }],
    receivers: receivers,
  });
}

function runToEnd(sim) {
  while (sim.step()) { /* advance */ }
  return sim;
}

function trace(sim, r) {
  const out = new Float32Array(sim.nt);
  for (let it = 0; it < sim.nt; it++) out[it] = sim.seismogram[it * sim.nrec + r];
  return out;
}

function argmaxAbs(arr) {
  let best = 0;
  for (let i = 1; i < arr.length; i++) if (Math.abs(arr[i]) > Math.abs(arr[best])) best = i;
  return best;
}

function energy(field) {
  let e = 0;
  for (let i = 0; i < field.length; i++) e += field[i] * field[i];
  return e;
}

test('stableDt scales with dx / vmax', () => {
  assert.ok(Math.abs(stableDt(4000, 10) - stableDt(2000, 10) / 2) < 1e-12);
  assert.throws(() => stableDt(0, 10));
});

test('rejects dt above the stability limit', () => {
  assert.throws(() => createSimulation({
    nx: NX, nz: NZ, dx: DX, dt: 0.7 * DX / V, nt: 10,
    velocity: homogeneous(V),
    sources: [{ ix: 60, iz: 60, wavelet: new Float32Array(10) }],
  }), /stability/);
});

test('rejects malformed input', () => {
  const base = {
    nx: NX, nz: NZ, dx: DX, nt: 10, velocity: homogeneous(V),
    sources: [{ ix: 60, iz: 60, wavelet: new Float32Array(10) }],
  };
  assert.throws(() => createSimulation({ ...base, velocity: new Float32Array(5) }), /nx \* nz/);
  assert.throws(() => createSimulation({ ...base, sources: [{ ix: NX, iz: 0, wavelet: new Float32Array(10) }] }), /outside/);
  assert.throws(() => createSimulation({ ...base, receivers: [{ ix: -1, iz: 0 }] }), /outside/);
  assert.throws(() => createSimulation({ ...base, velocity: homogeneous(V).fill(0, 0, 1) }), /positive/);
});

test('direct wave moveout matches the medium velocity', () => {
  // Receivers 200 m and 400 m from the source along x.
  const sim = runToEnd(centeredShot(700, [{ ix: 80, iz: 60 }, { ix: 100, iz: 60 }]));
  const tNear = argmaxAbs(trace(sim, 0)) * sim.dt;
  const tFar = argmaxAbs(trace(sim, 1)) * sim.dt;
  const measured = 200 / (tFar - tNear);
  assert.ok(Math.abs(measured - V) / V < 0.03, 'apparent velocity ' + measured.toFixed(1));
});

test('sponge absorbs outgoing energy and the field stays finite', () => {
  const sim = centeredShot(2500, []);
  let peak = 0;
  while (sim.step()) {
    const e = energy(sim.readWavefield());
    assert.ok(Number.isFinite(e), 'non-finite energy at step ' + sim.it);
    if (e > peak) peak = e;
  }
  const residual = energy(sim.readWavefield()) / peak;
  assert.ok(residual < 1e-2, 'residual energy ratio ' + residual.toExponential(2));
});
