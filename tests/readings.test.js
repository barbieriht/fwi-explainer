'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { PAGES, loadReferences, loadReadings, parseCsv } = require('../scripts/build-page.js');

const read = (file) => fs.readFileSync(path.join(__dirname, '..', file), 'utf8');

test('CSV parser handles quotes, commas and doubled quotes', () => {
  assert.deepEqual(parseCsv('a,"b, c","say ""hi"""\n1,2,3\n'), [['a', 'b, c', 'say "hi"'], ['1', '2', '3']]);
});

test('every reading resolves to a reference and has both sentences', () => {
  const refs = loadReferences();
  const rows = loadReadings(refs, PAGES[0].groups);
  assert.ok(rows.length > 0);
  for (const r of rows) {
    assert.ok(r.sentence_en && r.sentence_pt, r.id);
    assert.ok(['abstract', 'title'].includes(r.source), r.id);
  }
  assert.equal(new Set(rows.map((r) => r.id)).size, rows.length, 'duplicate reading');
});

test('pages show exactly the approved readings', () => {
  const approved = loadReadings(loadReferences(), PAGES[0].groups).filter((r) => r.approved === 'yes');
  for (const page of PAGES) {
    const html = read(page.file);
    const block = html.slice(html.indexOf('<!-- readings:start'), html.indexOf('<!-- readings:end -->'));
    const shown = Array.from(block.matchAll(/data-cite="([^"]+)"/g), (m) => m[1]).sort();
    assert.deepEqual(shown, approved.map((r) => r.id).sort(), page.file);
  }
});
