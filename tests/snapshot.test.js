'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

const read = (file) => fs.readFileSync(path.join(__dirname, '..', file), 'utf8');
const data = JSON.parse(read('assets/data/search-snapshot.json'));

test('snapshot counts add up', () => {
  const dated = data.years.reduce((sum, r) => sum + r.total, 0);
  assert.equal(dated + data.unknown_year, data.studies);
  for (const r of data.years) {
    for (const topic of data.topics) {
      assert.ok(r[topic] >= 0 && r[topic] <= r.total, `${r.year} ${topic}`);
    }
  }
  const byTopic = Object.fromEntries(data.topics.map((t) => [t, data.years.reduce((s, r) => s + r[t], 0)]));
  for (const t of data.topics) assert.ok(byTopic[t] <= data.topic_totals[t], t);
});

test('snapshot publishes aggregates only', () => {
  const allowed = new Set(['year', 'total', ...data.topics]);
  for (const r of data.years) assert.deepEqual(Object.keys(r).filter((k) => !allowed.has(k)), []);
  assert.doesNotMatch(read('assets/data/search-snapshot.json'), /"(title|abstract|doi|authors?)"/i);
});

test('the script twin carries the same snapshot as the JSON', () => {
  const window = {};
  new Function('window', read('assets/data/search-snapshot.js'))(window);
  assert.deepEqual(window.FWI_DATA.searchSnapshot, data);
});
