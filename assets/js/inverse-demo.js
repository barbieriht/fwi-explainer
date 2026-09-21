/*
 * Inversion demo: run gradient-descent FWI from a homogeneous starting model
 * and watch the model and the misfit curve evolve. Work is sliced per shot
 * (generator steps) so the page stays responsive.
 */
(function () {
  'use strict';

  const FWI = window.FWI || {};
  const setup = FWI.inverseSetup;
  const root = window.FWI && window.FWI.sections && document.getElementById('inversion-demo');
  if (!setup || !FWI.charts || !window.d3 || !root) return;

  // Build the demo only when its section is first opened.
  window.FWI.sections.whenOpen(root, function mount() {
    const t = window.FWI.i18n.t;
    const num = window.FWI.i18n.num;
    const MAX_ITERATIONS = 30;
    const MULTISCALE_SWITCH = 10; // iterations at low frequency before switching
    const MODEL_CANVAS_PX = 480;
  const FRAME_BUDGET_MS = 12; // work per animation frame before yielding to the browser
  const ITERATION_DONE = { iterationDone: true };

    const SCENARIOS = {
      good: { v0: 2000, band: 'high', geometry: 'crosswell' },
      skipped: { v0: 1700, band: 'high', geometry: 'crosswell' },
      multiscale: { v0: 1700, band: 'multi', geometry: 'crosswell' },
      surround: { v0: 1700, band: 'high', geometry: 'surround' },
    };

    const el = {
      truth: root.querySelector('[data-role="truth"]'),
      current: root.querySelector('[data-role="current"]'),
      chart: root.querySelector('[data-role="misfit-chart"]'),
      v0: root.querySelector('[data-role="v0"]'),
      v0Value: root.querySelector('[data-role="v0-value"]'),
      bands: root.querySelectorAll('input[name="inv-band"]'),
      geometries: root.querySelectorAll('input[name="inv-geometry"]'),
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
      height: 220, xLabel: t('inv.xLabel'), yLabel: t('inv.yLabel'),
      xDomain: [0, MAX_ITERATIONS], yDomain: [0, 1.05], xTicks: 6,
      ariaLabel: t('inv.aria'),
    });

    const truth = setup.trueModel();
    const observedCache = {};

    const state = {
      // run: { band, geometry, freq, phase, inversion, model, iteration, lastRatio,
      //        generator, segments: [[[iteration, J/J0]]], switchAt }
      run: null,
      playing: false,
      stopAfterIteration: false,
    };

    // Observed data for a band and geometry, simulated in slices and cached.
    function* observedSteps(freq, geometry) {
      const key = geometry + ':' + freq;
      if (!observedCache[key]) {
        observedCache[key] = yield* FWI.inversion.simulateSteps(setup.survey(freq, geometry), truth);
      }
      return observedCache[key];
    }

    function checkedValue(radios, fallback) {
      const checked = Array.prototype.find.call(radios, function (r) { return r.checked; });
      return checked ? checked.value : fallback;
    }

    function selectedBand() { return checkedValue(el.bands, 'high'); }
    function selectedGeometry() { return checkedValue(el.geometries, 'crosswell'); }

    function startFreq(band) {
      return band === 'high' ? setup.HIGH_HZ : setup.LOW_HZ;
    }

    // The whole run as one generator: it yields shot indices while working and
    // ITERATION_DONE after each iteration, so the pump can render in between.
    function* runSteps(run) {
      while (run.iteration < MAX_ITERATIONS) {
        if (!run.inversion) {
          run.phase = 'observed';
          const observed = yield* observedSteps(run.freq, run.geometry);
          run.inversion = FWI.inversion.createInversion(setup.survey(run.freq, run.geometry), observed, run.model, {
            vmin: setup.VMIN, vmax: setup.VMAX,
          });
        }
        run.phase = 'iterate';
        yield* run.inversion.iterate();
        run.iteration++;
        run.model = run.inversion.model;
        recordHistory(run);
        if (run.band === 'multi' && run.freq === setup.LOW_HZ && run.iteration === MULTISCALE_SWITCH) {
          run.freq = setup.HIGH_HZ;
          run.switchAt = run.iteration;
          run.inversion = null;
          run.segments.push([]);
        }
        yield ITERATION_DONE;
      }
    }

    function createRun() {
      const band = selectedBand();
      const run = {
        band: band, geometry: selectedGeometry(), freq: startFreq(band), phase: 'observed',
        inversion: null, model: setup.homogeneous(Number(el.v0.value)), iteration: 0, lastRatio: 1,
        segments: [[]], switchAt: null,
      };
      run.generator = runSteps(run);
      return run;
    }

    // ---------- rendering ----------

    function renderChart() {
      const run = state.run;
      const series = run ? run.segments.map(function (points, i) {
        return { className: i === 0 && run.band !== 'high' ? 'series-a' : 'series-b', points: points };
      }) : [];
      const markers = run && run.switchAt !== null ? [{ x: run.switchAt, label: t('inv.switch', { f: setup.HIGH_HZ }) }] : [];
      chart.update(series, markers);
    }

    function recordHistory(run) {
      const h = run.inversion.history;
      const offset = run.switchAt || 0;
      run.segments[run.segments.length - 1] = h.map(function (j, i) { return [offset + i, j / h[0]]; });
      run.lastRatio = h[h.length - 1] / h[0];
    }

    function render() {
      const geometry = selectedGeometry();
      setup.drawModel(el.truth, truth, geometry);
      setup.drawModel(el.current, state.run ? state.run.model : setup.homogeneous(Number(el.v0.value)), geometry);
      renderChart();
      const run = state.run;
      if (!run || run.iteration === 0) {
        el.progress.textContent = t('inv.progressZero', { max: MAX_ITERATIONS });
        return;
      }
      el.progress.textContent = t('inv.progress', {
        i: run.iteration, max: MAX_ITERATIONS, f: run.freq, pct: num(100 * run.lastRatio, 1),
      });
    }

    // ---------- run loop ----------

    function workStatus(run, shot) {
      return run.phase === 'observed'
        ? t('inv.simulating')
        : t('inv.computing', { s: shot + 1, n: setup.GEOMETRIES[run.geometry].shots.length });
    }

    // Advance the run for about one frame's worth of work, then let the browser paint.
    function pump() {
      const run = state.run;
      if (!state.playing || !run) return;
      const start = performance.now();
      let shot = 0;
      while (performance.now() - start < FRAME_BUDGET_MS) {
        const r = run.generator.next();
        if (r.done || run.iteration >= MAX_ITERATIONS) {
          render();
          setPlaying(false);
          el.status.textContent = t('inv.finished', { max: MAX_ITERATIONS });
          return;
        }
        if (r.value === ITERATION_DONE) {
          render();
          if (state.stopAfterIteration) {
            setPlaying(false);
            el.status.textContent = t('inv.pausedOne');
            return;
          }
          break;
        }
        shot = r.value || 0;
      }
      el.status.textContent = workStatus(run, shot);
      setTimeout(pump, 0);
    }

    function setPlaying(on, singleIteration) {
      const alreadyRunning = state.playing;
      state.playing = on;
      state.stopAfterIteration = Boolean(singleIteration);
      el.run.textContent = on && !singleIteration ? t('common.pause') : t('common.run');
      el.run.setAttribute('aria-pressed', String(on && !singleIteration));
      if (!on) {
        el.status.textContent = t('common.paused');
        return;
      }
      if (alreadyRunning) return; // the existing pump loop picks up the new mode
      if (!state.run || state.run.iteration >= MAX_ITERATIONS) state.run = createRun();
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
      el.geometries.forEach(function (r) { r.checked = r.value === s.geometry; });
      reset(t('inv.scenario'));
    }

    el.run.addEventListener('click', function () { setPlaying(!(state.playing && !state.stopAfterIteration)); });
    el.step.addEventListener('click', function () { if (!state.playing) setPlaying(true, true); });
    el.reset.addEventListener('click', function () { reset(t('inv.reset')); });
    el.v0.addEventListener('input', function () {
      el.v0Value.textContent = el.v0.value + ' m/s';
      reset(t('inv.v0Changed'));
    });
    el.bands.forEach(function (r) { r.addEventListener('change', function () { reset(t('inv.bandChanged')); }); });
    el.geometries.forEach(function (r) { r.addEventListener('change', function () { reset(t('inv.geometryChanged')); }); });
    el.scenarios.forEach(function (b) {
      b.addEventListener('click', function () { applyScenario(b.dataset.scenario); });
    });
    document.addEventListener('visibilitychange', function () { if (document.hidden) setPlaying(false); });

    el.v0.min = '1600';
    el.v0.max = '2400';
    el.v0.step = '50';
    applyScenario('skipped');

    window.FWI.sections.onClose(root, function () { setPlaying(false); });
  });
})();
