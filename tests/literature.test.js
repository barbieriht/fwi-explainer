'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const data = require('../assets/data/literature.json');
const { latexToText, TAG_RULES } = require('../scripts/import-literature.js');

test('literature records are complete and well-formed', () => {
  const ids = new Set();
  for (const r of data.references) {
    assert.ok(!ids.has(r.id), 'duplicate id ' + r.id);
    ids.add(r.id);
    assert.ok(r.title && r.venue && r.authors.length > 0, r.id);
    assert.ok(Number.isInteger(r.year) && r.year >= 1950 && r.year <= 2100, r.id);
    assert.ok(Object.keys(data.groups).includes(r.group), r.id);
    assert.ok(r.link === null || /^https:\/\//.test(r.link), r.id);
    assert.ok(r.tags.every((t) => data.tags.includes(t)), r.id);
    assert.ok(!/[\\${}]/.test(r.title + r.venue + r.authors.join('')), 'LaTeX left in ' + r.id);
  }
});

test('the survey has 16 papers, each with an insertion point', () => {
  const survey = data.references.filter((r) => r.group === 'survey');
  assert.equal(survey.length, 16);
  assert.ok(survey.every((r) => ['model', 'data', 'prior'].includes(r.insertion)));
});

test('tags follow only from the title', () => {
  for (const r of data.references) {
    const expected = TAG_RULES.filter(([, re]) => re.test(r.title.toLowerCase())).map(([t]) => t);
    assert.deepEqual(r.tags, expected, r.id);
  }
});

test('LaTeX conversion refuses unknown commands', () => {
  assert.equal(latexToText('{CNN} --- {Fourier}', 't'), 'CNN — Fourier');
  assert.throws(() => latexToText('\\emph{x}', 't'), /unhandled LaTeX/);
});
