/*
 * Classical FWI vs deep-learning comparison: a before/after slider over
 * pre-computed velocity images (scripts/dl/compare.py) plus a metrics table.
 * Reads window.FWI_DATA.dlComparison (assets/data/dl-comparison.js).
 */
(function () {
  'use strict';

  const root = window.FWI && window.FWI.sections && document.getElementById('dl-comparison');
  const data = window.FWI_DATA && window.FWI_DATA.dlComparison;
  if (!root) return;
  if (!data) {
    root.querySelector('[data-role="status"]').textContent = window.FWI.i18n.t('dl.missing');
    return;
  }

  // Build the demo only when its section is first opened.
  window.FWI.sections.whenOpen(root, function mount() {
    const t = window.FWI.i18n.t;
    const num = window.FWI.i18n.num;
    const IMG_DIR = 'assets/img/dl/';
    const LABELS = { true: t('dl.true'), start: t('dl.start'), fwi: t('dl.fwi'), dl: t('dl.dl'), hybrid: t('dl.hybrid') };

    const el = {
      cases: root.querySelectorAll('[data-case]'),
      left: root.querySelector('[data-role="left"]'),
      right: root.querySelector('[data-role="right"]'),
      leftImg: root.querySelector('[data-role="left-img"]'),
      rightImg: root.querySelector('[data-role="right-img"]'),
      leftTag: root.querySelector('[data-role="left-tag"]'),
      rightTag: root.querySelector('[data-role="right-tag"]'),
      divider: root.querySelector('[data-role="divider"]'),
      position: root.querySelector('[data-role="position"]'),
      truthImg: root.querySelector('[data-role="truth-img"]'),
      metrics: root.querySelector('[data-role="metrics"]'),
    };

    const state = { caseName: 'in-distribution' };

    function imageFor(method) {
      return IMG_DIR + state.caseName + '-' + method + '.png';
    }

    function renderImages() {
      el.leftImg.src = imageFor(el.left.value);
      el.leftImg.alt = LABELS[el.left.value];
      el.rightImg.src = imageFor(el.right.value);
      el.rightImg.alt = LABELS[el.right.value];
      el.leftTag.textContent = LABELS[el.left.value];
      el.rightTag.textContent = LABELS[el.right.value];
      el.truthImg.src = imageFor('true');
    }

    function renderSlider() {
      const pct = Number(el.position.value);
      el.leftImg.style.clipPath = 'inset(0 ' + (100 - pct) + '% 0 0)';
      el.divider.style.left = pct + '%';
    }

    function formatSeconds(s) {
      return s < 1 ? num(1000 * s) + ' ms' : num(s) + ' s';
    }

    function renderMetrics() {
      const m = data.cases[state.caseName];
      const rows = [
        ['start', m.mae_mps.start, '—'],
        ['fwi', m.mae_mps.fwi, t('dl.fwiTime', { time: formatSeconds(m.seconds.fwi), n: m.fwi_iterations })],
        ['dl', m.mae_mps.dl, t('dl.dlTime', { time: formatSeconds(m.seconds.dl) })],
        ['hybrid', m.mae_mps.hybrid, t('dl.hybridTime', { time: formatSeconds(m.seconds.hybrid), n: m.hybrid_iterations })],
      ];
      el.metrics.replaceChildren.apply(el.metrics, rows.map(function (r) {
        const tr = document.createElement('tr');
        [LABELS[r[0]], num(r[1]) + ' m/s', r[2]].forEach(function (text, i) {
          const cell = document.createElement(i === 0 ? 'th' : 'td');
          if (i === 0) cell.scope = 'row';
          cell.textContent = text;
          tr.appendChild(cell);
        });
        return tr;
      }));
    }

    function selectCase(name) {
      state.caseName = name;
      el.cases.forEach(function (b) { b.setAttribute('aria-pressed', String(b.dataset.case === name)); });
      renderImages();
      renderMetrics();
    }

    el.cases.forEach(function (b) { b.addEventListener('click', function () { selectCase(b.dataset.case); }); });
    el.left.addEventListener('change', renderImages);
    el.right.addEventListener('change', renderImages);
    el.position.addEventListener('input', renderSlider);

    const FORMATS = {
      mps: function (v) { return num(v) + ' m/s'; },
      ms: function (v) { return Math.max(1, Math.round(1000 * v)) + ' ms'; },
      minutes: function (v) { return t('dl.minutes', { n: num(v / 60, 1) }); },
      wholeMinutes: function (v) { return t('dl.minutes', { n: num(v) }); },
      seconds: function (v) { return num(v) + ' s'; },
      thousands: function (v) { return num(v); },
    };

    // Fill <span data-fill="path.to.value" data-format="..."> from the data, so
    // numbers in the prose always match the generated results.
    document.querySelectorAll('[data-fill]').forEach(function (node) {
      const value = node.dataset.fill.split('.').reduce(function (obj, key) {
        return obj === undefined ? undefined : obj[key];
      }, data);
      if (value === undefined) return;
      const format = FORMATS[node.dataset.format];
      node.textContent = format ? format(value) : String(value);
    });

    selectCase(state.caseName);
    renderSlider();
  });
})();
