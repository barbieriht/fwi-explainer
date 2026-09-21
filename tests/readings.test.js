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

test('every reading has a citation count and the list is ranked by it', () => {
  const { rankedReadings, loadCitations } = require('../scripts/build-page.js');
  const refs = loadReferences();
  const citations = loadCitations();
  for (const r of loadReadings(refs, PAGES[0].groups)) {
    assert.ok(Number.isInteger(citations.cited_by_count[r.id]), 'no count for ' + r.id);
  }
  const ranked = rankedReadings(refs, PAGES[0].groups, citations);
  for (let i = 1; i < ranked.length; i++) assert.ok(ranked[i - 1].citations >= ranked[i].citations);
  const html = read('index.html');
  const block = html.slice(html.indexOf('<!-- readings:start'), html.indexOf('<!-- readings:end -->'));
  assert.deepEqual(Array.from(block.matchAll(/data-cite="([^"]+)"/g), (m) => m[1]), ranked.map((r) => r.id));
});

test('every reading decision has a written review', () => {
  for (const r of loadReadings(loadReferences(), PAGES[0].groups)) assert.ok(r.review.length > 10, r.id);
});
