/*
 * Research landscape: every reference in literature.json on a timeline, one
 * lane per group (the survey split by where the network sits), with topic
 * filters, a detail panel and an accessible list of the papers shown.
 * Reads window.FWI_DATA.literature (assets/data/literature.js).
 */
(function () {
  'use strict';

  const root = window.FWI && window.FWI.sections && document.getElementById('landscape');
  const data = window.FWI_DATA && window.FWI_DATA.literature;
  if (!root || !data || !window.d3) return;

  const LANES = [
    { key: 'classical', labelKey: 'ls.classical', className: 'lane-classical',
      test: function (r) { return r.group === 'classical'; } },
    { key: 'model', labelKey: 'ls.model', className: 'lane-survey',
      test: function (r) { return r.group === 'survey' && r.insertion === 'model'; } },
    { key: 'data', labelKey: 'ls.data', className: 'lane-survey',
      test: function (r) { return r.group === 'survey' && r.insertion === 'data'; } },
    { key: 'prior', labelKey: 'ls.prior', className: 'lane-survey',
      test: function (r) { return r.group === 'survey' && r.insertion === 'prior'; } },
    { key: 'ml-native', labelKey: 'ls.ml', className: 'lane-ml',
      test: function (r) { return r.group === 'ml-native'; } },
  ];
  // Years before the break are compressed so the dense recent years get room.
  const YEAR_START = 1983;
  const YEAR_BREAK = 2019.5;
  const YEAR_END = 2026.9;
  const COMPRESSED_SHARE = 0.26;
  const DOT_RADIUS = 6;
  const STACK_STEP = 15; // px between papers sharing a lane and year
  const LANE_PADDING = 14;
  const LABEL_HEIGHT = 18;
  const MARGIN = { top: 4, right: 12, bottom: 30, left: 12 };
  const MAX_AUTHORS = 3;
  const NARROW_WIDTH = 520; // below this, fewer axis ticks

  function laneOf(ref) {
    return LANES.find(function (l) { return l.test(ref); });
  }

  function shortAuthors(authors) {
    return authors.length > MAX_AUTHORS ? authors.slice(0, MAX_AUTHORS).join(', ') + ' ' + window.FWI.i18n.t('ls.etAl') : authors.join(', ');
  }

  function citationLine(ref) {
    const parts = [ref.venue];
    if (ref.volume) parts.push(ref.volume + (ref.issue ? '(' + ref.issue + ')' : ''));
    if (ref.pages) parts.push(ref.pages);
    return parts.join(', ') + ' (' + ref.year + ')';
  }

  window.FWI.sections.whenOpen(root, function mount() {
    const t = window.FWI.i18n.t;
    const num = window.FWI.i18n.num;
    const tagName = window.FWI.i18n.tag;
    const d3 = window.d3;
    const refs = data.references.map(function (r) { return Object.assign({ lane: laneOf(r) }, r); })
      .filter(function (r) { return r.lane; });
    const state = { active: new Set(), selected: null };

    const el = {
      filters: root.querySelector('[data-role="filters"]'),
      count: root.querySelector('[data-role="count"]'),
      chart: root.querySelector('[data-role="chart"]'),
      legend: root.querySelector('[data-role="legend"]'),
      detail: root.querySelector('[data-role="detail"]'),
      list: root.querySelector('[data-role="list"]'),
    };

    // ---------- layout ----------

    // Stack papers that share a lane and a year.
    const stackIndex = new Map();
    const stackSize = new Map();
    refs.slice().sort(function (a, b) { return a.title.localeCompare(b.title); }).forEach(function (r) {
      const key = r.lane.key + ':' + r.year;
      stackIndex.set(r.id, stackSize.get(key) || 0);
      stackSize.set(key, (stackSize.get(key) || 0) + 1);
    });
    const laneHeight = LANES.map(function (lane) {
      let most = 1;
      stackSize.forEach(function (n, key) { if (key.startsWith(lane.key + ':')) most = Math.max(most, n); });
      return LABEL_HEIGHT + LANE_PADDING + (most - 1) * STACK_STEP + DOT_RADIUS * 2;
    });
    const laneTop = laneHeight.reduce(function (acc, h, i) { acc.push(i === 0 ? 0 : acc[i - 1] + laneHeight[i - 1]); return acc; }, []);

    const width = Math.max(320, Math.min(900, el.chart.clientWidth || 640));
    const innerW = width - MARGIN.left - MARGIN.right;
    const innerH = laneTop[laneTop.length - 1] + laneHeight[laneHeight.length - 1];
    const height = innerH + MARGIN.top + MARGIN.bottom;
    const x = d3.scaleLinear()
      .domain([YEAR_START, YEAR_BREAK, YEAR_END])
      .range([0, innerW * COMPRESSED_SHARE, innerW]);

    function dotY(r) {
      const lane = LANES.indexOf(r.lane);
      return laneTop[lane] + LABEL_HEIGHT + DOT_RADIUS + stackIndex.get(r.id) * STACK_STEP;
    }

    // ---------- chart ----------

    const svg = d3.select(el.chart).append('svg')
      .attr('viewBox', '0 0 ' + width + ' ' + height)
      .attr('class', 'chart landscape-chart')
      .attr('role', 'group')
      .attr('aria-label', t('ls.aria'));
    const plot = svg.append('g').attr('transform', 'translate(' + MARGIN.left + ',' + MARGIN.top + ')');

    LANES.forEach(function (lane, i) {
      const g = plot.append('g').attr('class', 'lane');
      if (i > 0) g.append('line').attr('class', 'lane-rule').attr('x1', 0).attr('x2', innerW).attr('y1', laneTop[i]).attr('y2', laneTop[i]);
      g.append('text').attr('class', 'lane-label').attr('x', 0).attr('y', laneTop[i] + 13).text(t(lane.labelKey));
    });

    const ticks = (width < NARROW_WIDTH ? [1984, 2005] : [1984, 1995, 2005, 2015])
      .concat(width < NARROW_WIDTH ? [2020, 2022, 2024, 2026] : [2020, 2021, 2022, 2023, 2024, 2025, 2026]);
    plot.append('g').attr('class', 'chart-axis').attr('transform', 'translate(0,' + innerH + ')')
      .call(d3.axisBottom(x).tickValues(ticks).tickFormat(d3.format('d')).tickSizeOuter(0));
    plot.append('text').attr('class', 'axis-break').attr('x', x(YEAR_BREAK)).attr('y', innerH + 4)
      .attr('text-anchor', 'middle').text('//');

    const dots = plot.append('g').selectAll('circle').data(refs).join('circle')
      .attr('class', function (r) { return 'paper-dot ' + r.lane.className; })
      .attr('cx', function (r) { return x(r.year); })
      .attr('cy', dotY)
      .attr('r', DOT_RADIUS)
      .attr('tabindex', 0)
      .attr('role', 'button')
      .attr('aria-label', function (r) { return r.title + ' (' + r.year + ')'; })
      .on('click', function (event, r) { select(r); })
      .on('keydown', function (event, r) {
        if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); select(r); }
      });
    dots.append('title').text(function (r) { return r.title + ' (' + r.year + ')'; });

    // ---------- legend and filters ----------

    [['lane-classical', t('ls.classical')], ['lane-survey', t('ls.legendSurvey')], ['lane-ml', t('ls.ml')]]
      .forEach(function (item) {
        const li = document.createElement('li');
        li.className = 'legend-dot ' + item[0];
        const span = document.createElement('span');
        span.textContent = item[1];
        li.appendChild(span);
        el.legend.appendChild(li);
      });

    function filterButton(label, tag) {
      const button = document.createElement('button');
      button.type = 'button';
      button.textContent = label;
      button.dataset.tag = tag || '';
      button.addEventListener('click', function () {
        if (!tag) state.active.clear();
        else if (state.active.has(tag)) state.active.delete(tag);
        else state.active.add(tag);
        render();
      });
      el.filters.appendChild(button);
    }
    filterButton(t('ls.allTopics'), null);
    data.tags.filter(function (tag) { return refs.some(function (r) { return r.tags.includes(tag); }); })
      .forEach(function (tag) { filterButton(tagName(tag), tag); });

    // ---------- detail and list ----------

    function isShown(r) {
      return state.active.size === 0 || r.tags.some(function (tag) { return state.active.has(tag); });
    }

    function renderDetail() {
      const r = state.selected;
      if (!r) return;
      el.detail.replaceChildren();
      const title = document.createElement('p');
      title.className = 'paper-title';
      title.textContent = r.title;
      const meta = document.createElement('p');
      meta.className = 'paper-meta';
      meta.textContent = shortAuthors(r.authors) + ' · ' + citationLine(r);
      const where = document.createElement('p');
      where.className = 'paper-meta';
      where.textContent = t(r.lane.labelKey) + (r.tags.length ? ' · ' + t('ls.topics') + ': ' + r.tags.map(tagName).join(', ') : '');
      el.detail.append(title, meta, where);
      if (r.link) {
        const a = document.createElement('a');
        a.href = r.link;
        a.textContent = r.doi ? t('ls.openDoi', { doi: r.doi }) : t('ls.openArxiv');
        a.rel = 'noopener';
        el.detail.appendChild(a);
      }
      if (!r.verified) {
        const note = document.createElement('p');
        note.className = 'paper-note';
        note.textContent = t('ls.unverified');
        el.detail.appendChild(note);
      }
    }

    function renderList(shown) {
      el.list.replaceChildren.apply(el.list, shown.slice().sort(function (a, b) {
        return b.year - a.year || a.title.localeCompare(b.title);
      }).map(function (r) {
        const li = document.createElement('li');
        const button = document.createElement('button');
        button.type = 'button';
        button.className = 'paper-list-item' + (state.selected === r ? ' selected' : '');
        button.textContent = r.title;
        button.addEventListener('click', function () { select(r); });
        const meta = document.createElement('span');
        meta.className = 'paper-meta';
        meta.textContent = shortAuthors(r.authors) + ' · ' + r.year;
        li.append(button, meta);
        return li;
      }));
    }

    function render() {
      const shown = refs.filter(isShown);
      dots.classed('faded', function (r) { return !isShown(r); })
        .classed('selected', function (r) { return state.selected === r; });
      el.filters.querySelectorAll('button').forEach(function (b) {
        const on = b.dataset.tag ? state.active.has(b.dataset.tag) : state.active.size === 0;
        b.setAttribute('aria-pressed', String(on));
      });
      el.count.textContent = state.active.size
        ? t('ls.countTagged', { shown: shown.length, total: refs.length, tags: Array.from(state.active).map(tagName).join(t('ls.or')) })
        : t('ls.count', { shown: shown.length, total: refs.length });
      renderList(shown);
      renderDetail();
    }

    function select(r) {
      state.selected = r;
      render();
    }

    render();
  });
})();
