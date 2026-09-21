'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { render, loadReferences, collectCitations } = require('../scripts/build-references.js');

test('every citation on the site resolves to a reference entry', () => {
  const refs = loadReferences();
  const missing = Array.from(collectCitations().keys()).filter((id) => !refs.has(id));
  assert.deepEqual(missing, []);
});

test('the bibliography in index.html is up to date with the citations used', () => {
  const current = fs.readFileSync(path.join(__dirname, '..', 'index.html'), 'utf8');
  assert.equal(render(), current, 'run: node scripts/build-references.js');
});
