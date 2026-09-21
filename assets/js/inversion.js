/*
 * Full-waveform inversion on top of solver.js.
 *
 * Misfit:   J(v) = 1/2 * sum over shots, receivers, samples of (d_syn - d_obs)^2
 * Gradient: adjoint-state method. The solver integrates m p_tt - lap(p) = f
 *           with m = 1/v^2, which is self-adjoint under time reversal, so the
 *           adjoint field is the same solver driven by time-reversed residuals
 *           at the receivers. Then dJ/dm(x) = -dx^2 sum_t lambda(x,t) p_tt(x,t) and
 *           dJ/dv = dJ/dm * (-2 / v^3).
 * Update:   steepest descent with a backtracking line search, velocities
 *           clamped to [vmin, vmax].
 *
 * Adapted from standard adjoint-state formulations.
 * Heavy loops are generators that yield every STEP_CHUNK time steps (the
 * yielded value is the current shot index), so callers can spread the work
 * over animation frames and keep the page responsive.
 */
(function (root) {
  'use strict';

  const solver = typeof module !== 'undefined' && module.exports
    ? require('./solver.js')
    : root.FWI.solver;

  const DEFAULT_MAX_UPDATE = 60; // m/s, largest first-trial change per iteration
  const LINE_SEARCH_TRIES = 4;
  const STEP_GROWTH = 1.5;
  const STEP_CHUNK = 64; // time steps between yields

  /*
   * opts: { nx, nz, dx, dt, nt, f0, shots: [{ix, iz}], receivers: [{ix, iz}],
   *         spongeCells? }
   */
  function createSurvey(opts) {
    if (!Array.isArray(opts.shots) || opts.shots.length === 0) throw new Error('survey needs shots');
    if (!Array.isArray(opts.receivers) || opts.receivers.length === 0) throw new Error('survey needs receivers');
    if (!(opts.f0 > 0)) throw new Error('f0 must be positive');
    return Object.freeze({
      nx: opts.nx, nz: opts.nz, dx: opts.dx, dt: opts.dt, nt: opts.nt, f0: opts.f0,
      shots: opts.shots.slice(), receivers: opts.receivers.slice(),
      spongeCells: opts.spongeCells,
      wavelet: solver.ricker(opts.f0, opts.dt, opts.nt),
    });
  }

  function simulationFor(survey, model, sources) {
    return solver.createSimulation({
      nx: survey.nx, nz: survey.nz, dx: survey.dx, dt: survey.dt, nt: survey.nt,
      velocity: model, sources: sources, receivers: survey.receivers,
      spongeCells: survey.spongeCells,
    });
  }

  // Runs `inner`, re-yielding each of its pauses as `label`; returns its result.
  function* relabel(inner, label) {
    for (;;) {
      const r = inner.next();
      if (r.done) return r.value;
      yield label;
    }
  }

  // Returns the shot record; if `history` is given, stores every snapshot in it.
  function* runShotSteps(survey, model, shot, history) {
    const sim = simulationFor(survey, model, [{ ix: shot.ix, iz: shot.iz, wavelet: survey.wavelet }]);
    const cells = survey.nx * survey.nz;
    while (sim.step()) {
      if (history) sim.readWavefield(history.subarray((sim.it - 1) * cells, sim.it * cells));
      if (sim.it % STEP_CHUNK === 0) yield;
    }
    return sim.seismogram;
  }

  function* simulateSteps(survey, model) {
    const records = [];
    for (let s = 0; s < survey.shots.length; s++) {
      records.push(yield* relabel(runShotSteps(survey, model, survey.shots[s], null), s));
    }
    return records;
  }

  function misfit(synthetic, observed) {
    let j = 0;
    for (let s = 0; s < synthetic.length; s++) {
      const syn = synthetic[s];
      const obs = observed[s];
      for (let i = 0; i < syn.length; i++) {
        const r = syn[i] - obs[i];
        j += r * r;
      }
    }
    return 0.5 * j;
  }

  // Time-reversed residual at each receiver becomes an adjoint source.
  function adjointSources(survey, synthetic, observed) {
    const nrec = survey.receivers.length;
    const nt = survey.nt;
    return survey.receivers.map(function (rec, r) {
      const w = new Float32Array(nt);
      for (let n = 0; n < nt; n++) {
        const k = (nt - 1 - n) * nrec + r;
        w[n] = synthetic[k] - observed[k];
      }
      return { ix: rec.ix, iz: rec.iz, wavelet: w };
    });
  }

  // Accumulates -dx^2 * sum_t lambda * p_tt into gradM for one shot and returns
  // its misfit. The dx^2 converts the solver's point-source units (f = w / dx^2).
  function* accumulateShotSteps(survey, model, shot, observed, history, gradM) {
    const cells = survey.nx * survey.nz;
    const nt = survey.nt;
    const synthetic = yield* runShotSteps(survey, model, shot, history);
    const adj = simulationFor(survey, model, adjointSources(survey, synthetic, observed));
    const lambda = new Float32Array(cells);
    const dx2 = survey.dx * survey.dx;
    const invDt2 = 1 / (survey.dt * survey.dt);
    // After adjoint step n' (adj.it = n' + 1) the field pairs with forward index nt - 1 - n'.
    while (adj.step()) {
      if (adj.it % STEP_CHUNK === 0) yield;
      const n = nt - 1 - adj.it;
      if (n < 1 || n > nt - 2) continue;
      adj.readWavefield(lambda);
      const prev = (n - 1) * cells;
      const curr = n * cells;
      const next = (n + 1) * cells;
      for (let i = 0; i < cells; i++) {
        const ptt = (history[next + i] - 2 * history[curr + i] + history[prev + i]) * invDt2;
        gradM[i] -= dx2 * lambda[i] * ptt;
      }
    }
    return misfit([synthetic], [observed]);
  }

  function* gradientSteps(survey, model, observed) {
    const cells = survey.nx * survey.nz;
    const history = new Float32Array(survey.nt * cells);
    const gradM = new Float64Array(cells);
    let j = 0;
    for (let s = 0; s < survey.shots.length; s++) {
      j += yield* relabel(accumulateShotSteps(survey, model, survey.shots[s], observed[s], history, gradM), s);
    }
    const gradV = new Float32Array(cells);
    for (let i = 0; i < cells; i++) {
      const v = model[i];
      gradV[i] = gradM[i] * (-2 / (v * v * v));
    }
    return { misfit: j, gradient: gradV };
  }

  function drain(generator) {
    for (;;) {
      const r = generator.next();
      if (r.done) return r.value;
    }
  }

  function simulate(survey, model) { return drain(simulateSteps(survey, model)); }
  function gradient(survey, model, observed) { return drain(gradientSteps(survey, model, observed)); }

  function maxAbs(arr) {
    let m = 0;
    for (let i = 0; i < arr.length; i++) m = Math.max(m, Math.abs(arr[i]));
    return m;
  }

  function updatedModel(model, direction, step, vmin, vmax) {
    const out = new Float32Array(model.length);
    for (let i = 0; i < model.length; i++) {
      out[i] = Math.min(vmax, Math.max(vmin, model[i] + step * direction[i]));
    }
    return out;
  }

  /*
   * options: { vmin, vmax, maxUpdate?, mask?: Float32Array(nx*nz) of 0..1 }
   * The mask tapers the gradient (e.g. next to sources and receivers, where
   * it is singular).
   */
  function createInversion(survey, observed, initialModel, options) {
    const vmin = options.vmin;
    const vmax = options.vmax;
    const mask = options.mask || null;
    let model = Float32Array.from(initialModel);
    let stepSize = options.maxUpdate || DEFAULT_MAX_UPDATE;
    let currentMisfit = null;
    const history = [];

    function* iterate() {
      const g = yield* gradientSteps(survey, model, observed);
      if (currentMisfit === null) {
        currentMisfit = g.misfit;
        history.push(g.misfit);
      }
      const direction = new Float32Array(g.gradient.length);
      for (let i = 0; i < direction.length; i++) {
        direction[i] = -g.gradient[i] * (mask ? mask[i] : 1);
      }
      const norm = maxAbs(direction);
      if (norm === 0) return { accepted: false, misfit: currentMisfit };
      for (let i = 0; i < direction.length; i++) direction[i] /= norm;

      for (let t = 0; t < LINE_SEARCH_TRIES; t++) {
        const trial = updatedModel(model, direction, stepSize, vmin, vmax);
        const j = misfit(yield* simulateSteps(survey, trial), observed);
        if (j < currentMisfit) {
          model = trial;
          currentMisfit = j;
          history.push(j);
          stepSize *= STEP_GROWTH;
          return { accepted: true, misfit: j };
        }
        stepSize /= 2;
      }
      history.push(currentMisfit);
      return { accepted: false, misfit: currentMisfit };
    }

    return {
      iterate: iterate,
      step: function () { return drain(iterate()); },
      get model() { return model; },
      get history() { return history.slice(); },
    };
  }

  const api = {
    createSurvey: createSurvey,
    simulate: simulate,
    simulateSteps: simulateSteps,
    misfit: misfit,
    gradient: gradient,
    gradientSteps: gradientSteps,
    createInversion: createInversion,
  };

  if (typeof module !== 'undefined' && module.exports) {
    module.exports = api;
  } else {
    root.FWI = root.FWI || {};
    root.FWI.inversion = api;
  }
})(typeof globalThis !== 'undefined' ? globalThis : this);
