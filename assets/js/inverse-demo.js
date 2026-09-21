/*
 * Inversion demo: run gradient-descent FWI from a homogeneous starting model
 * and watch the model and the misfit curve evolve. Work is sliced per shot
 * (generator steps) so the page stays responsive.
 */
(function () {
  'use strict';

  const FWI = window.FWI || {};
  const setup = FWI.inverseSetup;
  const root = document.getElementById('inversion-demo');
  if (!setup || !FWI.charts || !window.d3 || !root) return;

  const MAX_ITERATIONS = 30;
  const MULTISCALE_SWITCH = 10; // iterations at low frequency before switching
  const MODEL_CANVAS_PX = 300;

  const SCENARIOS = {
    good: { v0: 2000, band: 'high' },
    skipped: { v0: 1700, band: 'high' },
    multiscale: { v0: 1700, band: 'multi' },
  };

  const el = {
    truth: root.querySelector('[data-role="truth"]'),
    current: root.querySelector('[data-role="current"]'),
    chart: root.querySelector('[data-role="misfit-chart"]'),
    v0: root.querySelector('[data-role="v0"]'),
    v0Value: root.querySelector('[data-role="v0-value"]'),
    bands: root.querySelectorAll('input[name="inv-band"]'),
    scenarios: root.querySelectorAll('[data-scenario]'),
    run: root.querySelector('[data-role="run"]'),
    step: root.querySelector('[data-role="step"]'),
    reset: root.querySelector('[data-role="reset"]'),
    progress: root.querySelector('[data-role="progress"]'),
    status: root.querySelector('[data-role="status"]'),
  };

  [el.truth, el.current].forEach(function (c) {
    c.width = MODEL_CANVAS_PX;
    c.height = MODEL_CANVAS_PX;
  });

  const chart = FWI.charts.createLineChart(el.chart, {
    height: 220, xLabel: 'Iteration', yLabel: 'Misfit / starting misfit',
    xDomain: [0, MAX_ITERATIONS], yDomain: [0, 1.05], xTicks: 6,
    ariaLabel: 'Misfit versus iteration',
  });

  const truth = setup.trueModel();
  const mask = setup.gradientMask();
  const observedCache = {};

  const state = {
    run: null, // { inversion, freq, iteration, generator, segments: [[[it, J/J0]]], switchAt }
    playing: false,
    stopAfterIteration: false,
  };

  function observedFor(freq) {
    if (!observedCache[freq]) observedCache[freq] = FWI.inversion.simulate(setup.survey(freq), truth);
    return observedCache[freq];
  }

  function selectedBand() {
    const checked = Array.prototype.find.call(el.bands, function (r) { return r.checked; });
    return checked ? checked.value : 'high';
  }

  function startFreq(band) {
    return band === 'high' ? setup.HIGH_HZ : setup.LOW_HZ;
  }

  function newInversion(freq, model) {
    return FWI.inversion.createInversion(setup.survey(freq), observedFor(freq), model, {
      vmin: setup.VMIN, vmax: setup.VMAX, mask: mask,
    });
  }

  function createRun() {
    const band = selectedBand();
    const freq = startFreq(band);
    const inversion = newInversion(freq, setup.homogeneous(Number(el.v0.value)));
    return {
      band: band, freq: freq, inversion: inversion, iteration: 0,
      generator: inversion.iterate(), segments: [[]], switchAt: null,
    };
  }

  // ---------- rendering ----------

  function renderChart() {
    const run = state.run;
    const series = run ? run.segments.map(function (points, i) {
      return { className: i === 0 && run.band !== 'high' ? 'series-a' : 'series-b', points: points };
    }) : [];
    const markers = run && run.switchAt !== null ? [{ x: run.switchAt, label: 'switch to ' + setup.HIGH_HZ + ' Hz' }] : [];
    chart.update(series, markers);
  }

  function recordHistory(run) {
    const h = run.inversion.history;
    const offset = run.switchAt || 0;
    run.segments[run.segments.length - 1] = h.map(function (j, i) { return [offset + i, j / h[0]]; });
  }

  function render() {
    setup.drawModel(el.current, state.run ? state.run.inversion.model : setup.homogeneous(Number(el.v0.value)));
    renderChart();
    const run = state.run;
    if (!run || run.iteration === 0) {
      el.progress.textContent = 'Iteration 0 of ' + MAX_ITERATIONS;
      return;
    }
    const h = run.inversion.history;
    el.progress.textContent = 'Iteration ' + run.iteration + ' of ' + MAX_ITERATIONS + ' · ' + run.freq +
      ' Hz · misfit at ' + (100 * h[h.length - 1] / h[0]).toFixed(1) + '% of its starting value';
  }

  // ---------- run loop ----------

  function finishIteration(run) {
    run.iteration++;
    recordHistory(run);
    if (run.band === 'multi' && run.freq === setup.LOW_HZ && run.iteration === MULTISCALE_SWITCH) {
      run.freq = setup.HIGH_HZ;
      run.switchAt = run.iteration;
      run.inversion = newInversion(run.freq, run.inversion.model);
      run.segments.push([]);
    }
    run.generator = run.inversion.iterate();
    render();
  }

  function pump() {
    const run = state.run;
    if (!state.playing || !run) return;
    const r = run.generator.next();
    if (r.done) {
      finishIteration(run);
      if (run.iteration >= MAX_ITERATIONS) {
        setPlaying(false);
        el.status.textContent = 'Finished ' + MAX_ITERATIONS + ' iterations.';
        return;
      }
      if (state.stopAfterIteration) {
        setPlaying(false);
        el.status.textContent = 'Paused after one iteration.';
        return;
      }
    } else {
      el.status.textContent = 'Computing gradient and line search… (shot ' + (r.value + 1) + ' of ' + setup.SHOTS.length + ')';
    }
    setTimeout(pump, 0);
  }

  function setPlaying(on, singleIteration) {
    const alreadyRunning = state.playing;
    state.playing = on;
    state.stopAfterIteration = Boolean(singleIteration);
    el.run.textContent = on && !singleIteration ? 'Pause' : 'Run';
    el.run.setAttribute('aria-pressed', String(on && !singleIteration));
    if (!on) {
      el.status.textContent = 'Paused.';
      return;
    }
    if (alreadyRunning) return; // the existing pump loop picks up the new mode
    if (!state.run || state.run.iteration >= MAX_ITERATIONS) {
      el.status.textContent = 'Simulating observed data…';
      state.run = createRun();
    }
    setTimeout(pump, 0);
  }

  function reset(message) {
    setPlaying(false);
    state.run = null;
    render();
    el.status.textContent = message;
  }

  // ---------- controls ----------

  function applyScenario(name) {
    const s = SCENARIOS[name];
    el.v0.value = String(s.v0);
    el.v0Value.textContent = s.v0 + ' m/s';
    el.bands.forEach(function (r) { r.checked = r.value === s.band; });
    reset('Scenario loaded. Press Run.');
  }

  el.run.addEventListener('click', function () { setPlaying(!(state.playing && !state.stopAfterIteration)); });
  el.step.addEventListener('click', function () { if (!state.playing) setPlaying(true, true); });
  el.reset.addEventListener('click', function () { reset('Reset. Press Run to start again.'); });
  el.v0.addEventListener('input', function () {
    el.v0Value.textContent = el.v0.value + ' m/s';
    reset('Starting model changed. Press Run.');
  });
  el.bands.forEach(function (r) { r.addEventListener('change', function () { reset('Frequency band changed. Press Run.'); }); });
  el.scenarios.forEach(function (b) {
    b.addEventListener('click', function () { applyScenario(b.dataset.scenario); });
  });
  document.addEventListener('visibilitychange', function () { if (document.hidden) setPlaying(false); });

  el.v0.min = '1600';
  el.v0.max = '2400';
  el.v0.step = '50';
  setup.drawModel(el.truth, truth);
  applyScenario('skipped');
})();
