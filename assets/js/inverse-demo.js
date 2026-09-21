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
    const MODEL_CANVAS_PX = 300;

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
      run: null, // { inversion, freq, iteration, generator, segments: [[[it, J/J0]]], switchAt }
      playing: false,
      stopAfterIteration: false,
    };

    function observedFor(freq, geometry) {
      const key = geometry + ':' + freq;
      if (!observedCache[key]) observedCache[key] = FWI.inversion.simulate(setup.survey(freq, geometry), truth);
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

    function newInversion(freq, geometry, model) {
      return FWI.inversion.createInversion(setup.survey(freq, geometry), observedFor(freq, geometry), model, {
        vmin: setup.VMIN, vmax: setup.VMAX,
      });
    }

    function createRun() {
      const band = selectedBand();
      const geometry = selectedGeometry();
      const freq = startFreq(band);
      const inversion = newInversion(freq, geometry, setup.homogeneous(Number(el.v0.value)));
      return {
        band: band, geometry: geometry, freq: freq, inversion: inversion, iteration: 0,
        generator: inversion.iterate(), segments: [[]], switchAt: null,
      };
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
    }

    function render() {
      const geometry = selectedGeometry();
      setup.drawModel(el.truth, truth, geometry);
      setup.drawModel(el.current, state.run ? state.run.inversion.model : setup.homogeneous(Number(el.v0.value)), geometry);
      renderChart();
      const run = state.run;
      if (!run || run.iteration === 0) {
        el.progress.textContent = t('inv.progressZero', { max: MAX_ITERATIONS });
        return;
      }
      const h = run.inversion.history;
      el.progress.textContent = t('inv.progress', {
        i: run.iteration, max: MAX_ITERATIONS, f: run.freq, pct: num(100 * h[h.length - 1] / h[0], 1),
      });
    }

    // ---------- run loop ----------

    function finishIteration(run) {
      run.iteration++;
      recordHistory(run);
      if (run.band === 'multi' && run.freq === setup.LOW_HZ && run.iteration === MULTISCALE_SWITCH) {
        run.freq = setup.HIGH_HZ;
        run.switchAt = run.iteration;
        run.inversion = newInversion(run.freq, run.geometry, run.inversion.model);
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
          el.status.textContent = t('inv.finished', { max: MAX_ITERATIONS });
          return;
        }
        if (state.stopAfterIteration) {
          setPlaying(false);
          el.status.textContent = t('inv.pausedOne');
          return;
        }
      } else {
        el.status.textContent = t('inv.computing', { s: r.value + 1, n: setup.GEOMETRIES[run.geometry].shots.length });
      }
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
      if (!state.run || state.run.iteration >= MAX_ITERATIONS) {
        el.status.textContent = t('inv.simulating');
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
