'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { render, loadReferences, collectCitations } = require('../scripts/build-page.js');

const INDEX = path.join(__dirname, '..', 'index.html');

test('every citation on the page resolves to a reference entry', () => {
  const refs = loadReferences();
  const cited = Array.from(collectCitations(fs.readFileSync(INDEX, 'utf8')).keys());
  assert.ok(cited.length > 0);
  assert.deepEqual(cited.filter((id) => !refs.has(id)), []);
});

test('generated parts of index.html are up to date', () => {
  assert.equal(render(), fs.readFileSync(INDEX, 'utf8'), 'run: node scripts/build-page.js');
});

test('citation labels are unique', () => {
  const labels = Array.from(loadReferences().values()).map((r) => r.label);
  assert.equal(new Set(labels).size, labels.length);
});
