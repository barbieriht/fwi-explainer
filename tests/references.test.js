'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { PAGES, render, loadReferences, collectCitations } = require('../scripts/build-page.js');

const read = (file) => fs.readFileSync(path.join(__dirname, '..', file), 'utf8');

for (const page of PAGES) {
  test(`every citation in ${page.file} resolves to a reference entry`, () => {
    const refs = loadReferences();
    const cited = Array.from(collectCitations(read(page.file)).keys());
    assert.ok(cited.length > 0);
    assert.deepEqual(cited.filter((id) => !refs.has(id)), []);
  });

  test(`generated parts of ${page.file} are up to date`, () => {
    assert.equal(render(page.file), read(page.file), 'run: node scripts/build-page.js');
  });
}

test('citation labels are unique', () => {
  const labels = Array.from(loadReferences().values()).map((r) => r.label);
  assert.equal(new Set(labels).size, labels.length);
});
