/*
 * Search snapshot: aggregate counts from the author's collected studies
 * (assets/data/search-snapshot.js, built by scripts/import-zotero.py).
 *  1. Studies per year, split into those mentioning ML/deep learning and others.
 *  2. Share of studies per topic before and after a split year (dumbbell plot).
 */
(function () {
  'use strict';

  const root = window.FWI && window.FWI.sections && document.getElementById('snapshot');
  const data = window.FWI_DATA && window.FWI_DATA.searchSnapshot;
  if (!root || !data || !window.d3) return;

  const SPLIT_YEAR = 2021; // periods: before / from this year on
  const MIN_WIDTH = 300;
  const MAX_WIDTH = 640;

  window.FWI.sections.whenOpen(root, function mount() {
    const d3 = window.d3;
    const t = window.FWI.i18n.t;
    const num = window.FWI.i18n.num;

    const el = {
      years: root.querySelector('[data-role="years-chart"]'),
      topics: root.querySelector('[data-role="topics-chart"]'),
      summary: root.querySelector('[data-role="summary"]'),
    };

    function localDate(iso) {
      const locale = window.FWI.i18n.lang === 'pt' ? 'pt-BR' : 'en-US';
      return new Date(iso + 'T12:00:00').toLocaleDateString(locale, { year: 'numeric', month: 'short', day: 'numeric' });
    }

    function chartWidth(container) {
      return Math.min(MAX_WIDTH, Math.max(MIN_WIDTH, container.clientWidth || MAX_WIDTH));
    }

    function yearLabel(bucket) {
      return bucket === data.partial_year ? bucket + '*' : bucket;
    }

    // ---------- 1. studies per year ----------

    function drawYears() {
      const width = chartWidth(el.years);
      const height = 230;
      const m = { top: 12, right: 12, bottom: 36, left: 44 };
      const innerW = width - m.left - m.right;
      const innerH = height - m.top - m.bottom;
      const rows = data.years;
      const x = d3.scaleBand().domain(rows.map(function (r) { return r.year; })).range([0, innerW]).padding(0.2);
      const y = d3.scaleLinear().domain([0, d3.max(rows, function (r) { return r.total; })]).nice().range([innerH, 0]);

      const svg = d3.select(el.years).append('svg')
        .attr('viewBox', '0 0 ' + width + ' ' + height).attr('class', 'chart')
        .attr('role', 'img').attr('aria-label', t('sn.yearsAria'));
      const g = svg.append('g').attr('transform', 'translate(' + m.left + ',' + m.top + ')');
      g.append('g').attr('class', 'chart-grid').selectAll('line').data(y.ticks(4)).join('line')
        .attr('x1', 0).attr('x2', innerW).attr('y1', y).attr('y2', y);
      g.append('g').attr('class', 'chart-axis').attr('transform', 'translate(0,' + innerH + ')')
        .call(d3.axisBottom(x).tickFormat(yearLabel).tickSizeOuter(0))
        .selectAll('text').attr('transform', width < 480 ? 'rotate(-40)' : null)
        .style('text-anchor', width < 480 ? 'end' : null);
      g.append('g').attr('class', 'chart-axis').call(d3.axisLeft(y).ticks(4).tickSizeOuter(0));
      svg.append('text').attr('class', 'chart-label').attr('transform', 'translate(12,' + (m.top + innerH / 2) + ') rotate(-90)')
        .attr('text-anchor', 'middle').text(t('sn.studies'));

      const bars = g.selectAll('g.bar').data(rows).join('g').attr('class', 'bar')
        .attr('transform', function (r) { return 'translate(' + x(r.year) + ',0)'; });
      bars.append('rect').attr('class', 'bar-other')
        .attr('y', function (r) { return y(r.total); }).attr('height', function (r) { return y(0) - y(r.total - r.ml); })
        .attr('width', x.bandwidth());
      bars.append('rect').attr('class', 'bar-ml')
        .attr('y', function (r) { return y(r.ml); }).attr('height', function (r) { return y(0) - y(r.ml); })
        .attr('width', x.bandwidth());
      bars.append('title').text(function (r) {
        return t('sn.barTitle', { year: yearLabel(r.year), total: r.total, ml: r.ml });
      });
    }

    // ---------- 2. topic share before / after the split ----------

    function periodShares() {
      const early = { total: 0 };
      const late = { total: 0 };
      data.topics.forEach(function (topic) { early[topic] = 0; late[topic] = 0; });
      data.years.forEach(function (r) {
        const bucket = /^\d+$/.test(r.year) && Number(r.year) >= SPLIT_YEAR ? late : early;
        bucket.total += r.total;
        data.topics.forEach(function (topic) { bucket[topic] += r[topic]; });
      });
      return data.topics.map(function (topic) {
        return { topic: topic, early: early[topic] / early.total, late: late[topic] / late.total };
      }).sort(function (a, b) { return (b.late - b.early) - (a.late - a.early); });
    }

    function drawTopics(shares) {
      const width = chartWidth(el.topics);
      // Each topic gets its label on one line and its dumbbell on the next, so
      // long (translated) labels never get clipped on narrow screens.
      const rowH = 46;
      const labelGap = 16;
      const m = { top: 4, right: 16, bottom: 32, left: 8 };
      const innerW = width - m.left - m.right;
      const innerH = shares.length * rowH;
      const height = innerH + m.top + m.bottom;
      const x = d3.scaleLinear().domain([0, Math.max(0.5, d3.max(shares, function (s) { return Math.max(s.early, s.late); }))]).nice().range([0, innerW]);
      const y = d3.scaleBand().domain(shares.map(function (s) { return s.topic; })).range([0, innerH]);

      const svg = d3.select(el.topics).append('svg')
        .attr('viewBox', '0 0 ' + width + ' ' + height).attr('class', 'chart')
        .attr('role', 'img').attr('aria-label', t('sn.topicsAria', { year: SPLIT_YEAR }));
      const g = svg.append('g').attr('transform', 'translate(' + m.left + ',' + m.top + ')');
      g.append('g').attr('class', 'chart-grid').selectAll('line').data(x.ticks(5)).join('line')
        .attr('x1', x).attr('x2', x).attr('y1', 0).attr('y2', innerH);
      g.append('g').attr('class', 'chart-axis').attr('transform', 'translate(0,' + innerH + ')')
        .call(d3.axisBottom(x).ticks(width < 480 ? 3 : 5).tickFormat(function (v) { return num(100 * v) + '%'; }).tickSizeOuter(0));
      g.selectAll('text.topic-label').data(shares).join('text')
        .attr('class', 'chart-label topic-label').attr('x', 0)
        .attr('y', function (s) { return y(s.topic) + 12; })
        .text(function (s) { return t('sn.topic.' + s.topic); });

      const rows = g.selectAll('g.dumbbell').data(shares).join('g').attr('class', 'dumbbell')
        .attr('transform', function (s) { return 'translate(0,' + (y(s.topic) + 12 + labelGap) + ')'; });
      rows.append('line').attr('class', 'dumbbell-link')
        .attr('x1', function (s) { return x(s.early); }).attr('x2', function (s) { return x(s.late); });
      rows.append('circle').attr('class', 'dot-early').attr('r', 5).attr('cx', function (s) { return x(s.early); });
      rows.append('circle').attr('class', 'dot-late').attr('r', 5).attr('cx', function (s) { return x(s.late); });
      rows.append('title').text(function (s) {
        return t('sn.dotTitle', { topic: t('sn.topic.' + s.topic), early: num(100 * s.early), late: num(100 * s.late), year: SPLIT_YEAR });
      });
    }

    const shares = periodShares();
    drawYears();
    drawTopics(shares);
    const ml = shares.find(function (s) { return s.topic === 'ml'; });
    el.summary.textContent = t('sn.summary', {
      n: data.studies, date: localDate(data.snapshot_date), partial: data.partial_year,
      early: num(100 * ml.early), late: num(100 * ml.late), year: SPLIT_YEAR,
    });
  });
})();
