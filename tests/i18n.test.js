'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

const read = (file) => fs.readFileSync(path.join(__dirname, '..', file), 'utf8');
const EN = read('index.html');
const PT = read('index.pt.html');

function all(html, pattern) {
  return Array.from(html.matchAll(pattern), (m) => m[1]);
}

// The two language versions must have the same structure: only text differs.
const STRUCTURE = {
  'element ids': / id="([^"]+)"/g,
  'data-role hooks': /data-role="([^"]+)"/g,
  'form control values': /<(?:option|input)[^>]* value="([^"]*)"/g,
  'scripts': /<script src="([^"]+)"/g,
  'cite-list queries': /data-cite-list="([^"]+)"/g,
  'citations': /data-cite="([^"]+)"/g,
  'data-fill hooks': /data-fill="([^"]+)"/g,
  'in-page links': /href="(#[^"]*)"/g,
};

for (const [name, pattern] of Object.entries(STRUCTURE)) {
  test(`index.html and index.pt.html have the same ${name}`, () => {
    assert.deepEqual(all(PT, pattern), all(EN, pattern));
  });
}

test('each page declares its language and marks itself in the switch', () => {
  assert.match(EN, /<html lang="en">/);
  assert.match(PT, /<html lang="pt-BR">/);
  assert.match(EN, /href="index.html" hreflang="en" lang="en" aria-current="true"/);
  assert.match(PT, /href="index.pt.html" hreflang="pt-BR" lang="pt-BR" aria-current="true"/);
});

test('runtime strings exist in both languages', () => {
  const window = {};
  const document = { documentElement: { lang: 'en' }, querySelectorAll: () => [] };
  new Function('globalThis', 'document', 'window', read('assets/js/i18n.js'))(window, document, window);
  const { en, pt } = window.FWI.i18n.STRINGS;
  assert.deepEqual(Object.keys(pt).sort(), Object.keys(en).sort());
  for (const key of Object.keys(en)) {
    const placeholders = (s) => (s.match(/\{\w+\}/g) || []).sort();
    assert.deepEqual(placeholders(pt[key]), placeholders(en[key]), key);
  }
});
