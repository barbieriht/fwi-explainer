/*
 * Misfit landscape demo: for one shot, scan homogeneous starting velocities and
 * plot the misfit for low- and high-frequency data, next to the observed and
 * modeled traces at one receiver. Computed lazily when scrolled into view.
 */
(function () {
  'use strict';

  const FWI = window.FWI || {};
  const setup = FWI.inverseSetup;
  const root = window.FWI && window.FWI.sections && document.getElementById('misfit-landscape');
  if (!setup || !FWI.charts || !window.d3 || !root) return;

  // Build the demo only when its section is first opened.
  window.FWI.sections.whenOpen(root, function mount() {
    const t = window.FWI.i18n.t;
    const num = window.FWI.i18n.num;
    const V_START = 1500;
    const V_STOP = 2600;
    const V_STEP = 50;
    const GEOMETRY = 'crosswell';
    const MIDDLE_SHOT = setup.GEOMETRIES[GEOMETRY].shots[2];
    const MIDDLE_RECEIVER = 12; // same depth as the middle shot
    const MAX_LAG_SECONDS = 0.25;
    const FREQS = [setup.LOW_HZ, setup.HIGH_HZ];

    const velocities = [];
    for (let v = V_START; v <= V_STOP; v += V_STEP) velocities.push(v);

    const el = {
      slider: root.querySelector('[data-role="v0"]'),
      sliderValue: root.querySelector('[data-role="v0-value"]'),
      freqs: root.querySelectorAll('input[name="ml-freq"]'),
      landscape: root.querySelector('[data-role="landscape-chart"]'),
      trace: root.querySelector('[data-role="trace-chart"]'),
      readout: root.querySelector('[data-role="readout"]'),
      status: root.querySelector('[data-role="status"]'),
      start: root.querySelector('[data-role="start"]'),
    };

    const landscapeChart = FWI.charts.createLineChart(el.landscape, {
      height: 240, xLabel: t('ml.xLabel'), yLabel: t('ml.yLabel'),
      xDomain: [V_START, V_STOP], yDomain: [0, 1],
      ariaLabel: t('ml.aria'),
    });
    const traceChart = FWI.charts.createLineChart(el.trace, {
      height: 240, xLabel: t('ml.traceX'), yLabel: t('ml.traceY'),
      xDomain: [0, setup.NT * setup.DT], yDomain: [-1, 1],
      ariaLabel: t('ml.traceAria'),
    });

    // results[f] = { misfit: number[], traces: Float32Array[], observed: Float32Array }
    const results = {};
    let computed = false;
    let started = false;

    function traceAt(record) {
      const nrec = setup.GEOMETRIES[GEOMETRY].receivers.length;
      const out = new Float32Array(setup.NT);
      for (let it = 0; it < setup.NT; it++) out[it] = record[it * nrec + MIDDLE_RECEIVER];
      return out;
    }

    // Lag (s) that best aligns modeled with observed; positive = modeled is late.
    function arrivalShift(observed, modeled) {
      const maxLag = Math.round(MAX_LAG_SECONDS / setup.DT);
      let best = 0;
      let bestScore = -Infinity;
      for (let lag = -maxLag; lag <= maxLag; lag++) {
        let score = 0;
        for (let t = Math.max(0, -lag); t < Math.min(observed.length, observed.length - lag); t++) {
          score += observed[t] * modeled[t + lag];
        }
        if (score > bestScore) { bestScore = score; best = lag; }
      }
      return best * setup.DT;
    }

    function* computeSteps() {
      const truth = setup.trueModel();
      for (const f of FREQS) {
        const survey = setup.survey(f, GEOMETRY, [MIDDLE_SHOT]);
        const observed = FWI.inversion.simulate(survey, truth);
        const entry = { misfit: [], traces: [], observed: traceAt(observed[0]) };
        results[f] = entry;
        for (let k = 0; k < velocities.length; k++) {
          const synthetic = FWI.inversion.simulate(survey, setup.homogeneous(velocities[k]));
          entry.misfit.push(FWI.inversion.misfit(synthetic, observed));
          entry.traces.push(traceAt(synthetic[0]));
          yield (FREQS.indexOf(f) * velocities.length + k + 1) / (FREQS.length * velocities.length);
        }
      }
    }

    function normalized(values) {
      const max = Math.max.apply(null, values);
      return values.map(function (v) { return max > 0 ? v / max : 0; });
    }

    function traceMax(traces) {
      let m = 0;
      traces.forEach(function (trace) { for (let i = 0; i < trace.length; i++) m = Math.max(m, Math.abs(trace[i])); });
      return m || 1;
    }

    function selectedFreq() {
      const checked = Array.prototype.find.call(el.freqs, function (r) { return r.checked; });
      return Number(checked ? checked.value : setup.HIGH_HZ);
    }

    function render() {
      const v0 = Number(el.slider.value);
      el.sliderValue.textContent = v0 + ' m/s';
      if (!computed) return;
      const k = velocities.indexOf(v0);
      const f = selectedFreq();

      landscapeChart.update(
        FREQS.map(function (freq, i) {
          return {
            className: i === 0 ? 'series-a' : 'series-b',
            points: normalized(results[freq].misfit).map(function (j, idx) { return [velocities[idx], j]; }),
          };
        }),
        [{ x: setup.BACKGROUND, label: t('ml.true') }, { x: v0, label: t('ml.guess') }]
      );

      const scale = 1 / traceMax([results[f].observed, results[f].traces[k]]);
      const toPoints = function (trace) {
        return Array.from(trace, function (value, it) { return [it * setup.DT, value * scale]; });
      };
      traceChart.update([
        { className: 'series-a', points: toPoints(results[f].observed) },
        { className: 'series-b', dashed: true, points: toPoints(results[f].traces[k]) },
      ], []);

      // Arrival shift measured on the low-frequency traces, which cannot cycle-skip here.
      const shiftMs = 1000 * arrivalShift(results[setup.LOW_HZ].observed, results[setup.LOW_HZ].traces[k]);
      const halfPeriodMs = 1000 / (2 * f);
      const skipped = Math.abs(shiftMs) > halfPeriodMs;
      el.readout.textContent = t('ml.readout', {
        shift: num(Math.abs(shiftMs)), direction: shiftMs >= 0 ? t('ml.late') : t('ml.early'),
        f: f, half: num(halfPeriodMs), verdict: skipped ? t('ml.skipped') : t('ml.reach'),
      });
      el.readout.classList.toggle('warning', skipped);
    }

    function start() {
      if (started) return;
      started = true;
      el.start.disabled = true;
      const steps = computeSteps();
      (function pump() {
        const r = steps.next();
        if (!r.done) {
          el.status.textContent = t('ml.progress', { pct: Math.round(100 * r.value) });
          setTimeout(pump, 0);
          return;
        }
        computed = true;
        el.status.textContent = t('ml.ready');
        el.start.hidden = true;
        render();
      })();
    }

    el.slider.min = String(V_START);
    el.slider.max = String(V_STOP);
    el.slider.step = String(V_STEP);
    el.slider.value = '1700';
    el.slider.addEventListener('input', render);
    el.freqs.forEach(function (r) { r.addEventListener('change', render); });
    el.start.addEventListener('click', start);

    if ('IntersectionObserver' in window) {
      const observer = new IntersectionObserver(function (entries) {
        if (entries.some(function (e) { return e.isIntersecting; })) {
          observer.disconnect();
          start();
        }
      }, { rootMargin: '200px' });
      observer.observe(root);
    }
    render();
  });
})();
