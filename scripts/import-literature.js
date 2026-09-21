#!/usr/bin/env node
/*
 * Imports the author's literature corpus from the thesis bibliography into
 * assets/data/literature.json (+ a literature.js twin for file:// use).
 *
 *   node scripts/import-literature.js "/path/to/Overleaf Project/references.bib"
 *
 * Only bibliographic fields are copied; comments in the .bib (working notes)
 * are never read into the output. Entries followed by a "% VERIFY" comment are
 * marked verified: false. Tags are derived from titles with the explicit
 * keyword rules below, so every tag can be traced to the title text.
 */
'use strict';

const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const OUT_JSON = path.join(ROOT, 'assets/data/literature.json');
const OUT_JS = path.join(ROOT, 'assets/data/literature.js');

// .bib section header -> group and (for the survey) where the network sits.
const SECTIONS = {
  'Classical FWI': { group: 'classical', insertion: null },
  'Surveyed corpus: model-side reparameterisation': { group: 'survey', insertion: 'model' },
  'Surveyed corpus: data-side learned misfits': { group: 'survey', insertion: 'data' },
  'Surveyed corpus: prior-side regularisation and 4D': { group: 'survey', insertion: 'prior' },
  'Machine-learning-native line': { group: 'ml-native', insertion: null },
};

// Tag -> title pattern (case-insensitive). Order is the display order.
const TAG_RULES = [
  ['multiparameter', /multi-?parameter|elastic|petrophysical/],
  ['crosstalk', /crosstalk|cross-talk/],
  ['cycle-skipping', /cycle[- ]skipping/],
  ['uncertainty', /uncertainty|bayesian|variational|posterior/],
  ['time-lapse', /time-lapse|monitoring/],
  ['CNN', /\bcnn\b|convolutional/],
  ['MLP', /multilayer perceptron/],
  ['neural representation', /implicit|neural representation/],
  ['physics-informed', /physics-informed|physics-constrained/],
  ['self-supervised', /self-supervised/],
  ['learned prior', /diffusion|\bw?gan\b|generative|variational autoencoder|learned priors?|prior model|learned regularization|learning-assisted regularization/],
  ['misfit function', /misfit|objective function|siamese|data comparison/],
  ['reparameterization', /reparameteri/],
  ['neural operator', /neural operator/],
  ['multiscale', /multiscale/],
  ['optimal transport', /optimal transport/],
  ['benchmark', /benchmark|data ?set/],
];

// ------------------------------------------------------------- bib parsing

function readBraced(text, start) {
  // text[start] === '{'; returns [content, indexAfterClosingBrace]
  let depth = 0;
  for (let i = start; i < text.length; i++) {
    if (text[i] === '{') depth++;
    else if (text[i] === '}') {
      depth--;
      if (depth === 0) return [text.slice(start + 1, i), i + 1];
    }
  }
  throw new Error('unbalanced braces near: ' + text.slice(start, start + 60));
}

function parseFields(body) {
  const fields = {};
  const pattern = /(\w+)\s*=\s*\{/g;
  let m;
  while ((m = pattern.exec(body))) {
    const [value, end] = readBraced(body, m.index + m[0].length - 1);
    fields[m[1].toLowerCase()] = value;
    pattern.lastIndex = end;
  }
  return fields;
}

// Splits the .bib into entries, remembering the section header above each one
// and whether a "% VERIFY" comment follows it before the next entry.
function parseBib(text) {
  const entries = [];
  const lines = text.split('\n');
  let section = null;
  let current = null;
  const finish = function () { if (current) entries.push(current); current = null; };
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const header = /^% -{5,} (.*?) -{5,}/.exec(line);
    if (header) { finish(); section = header[1].trim(); continue; }
    const start = /^@(\w+)\{([^,]+),/.exec(line);
    if (start) {
      finish();
      const offset = lines.slice(0, i).join('\n').length + (i ? 1 : 0);
      const [inner] = readBraced(text, text.indexOf('{', offset));
      current = { type: start[1].toLowerCase(), key: start[2].trim(), section: section,
        fields: parseFields(inner.slice(inner.indexOf(',') + 1)), verify: false };
      continue;
    }
    if (current && /^%\s*VERIFY\b/.test(line)) current.verify = true;
  }
  finish();
  return entries;
}

// ------------------------------------------------------------ LaTeX -> text

const LATEX_REPLACEMENTS = [
  [/\$\\mathbb\{E\}\^\{FWI\}\$/g, '𝔼^FWI'],
  [/CO\$_2\$/g, 'CO₂'],
  [/---/g, '—'],
  [/--/g, '–'],
  [/\\&/g, '&'],
  [/\\'\\i/g, 'í'], [/\\'e/g, 'é'], [/\\'\{e\}/g, 'é'], [/\\"o/g, 'ö'], [/\\"\{o\}/g, 'ö'], [/\\"u/g, 'ü'], [/\\"\{u\}/g, 'ü'],
  [/\\~a/g, 'ã'], [/\\c\{c\}/g, 'ç'],
  [/[{}]/g, ''],
];

function latexToText(value, context) {
  const text = LATEX_REPLACEMENTS.reduce(function (s, rule) { return s.replace(rule[0], rule[1]); }, value)
    .replace(/\s+/g, ' ').trim();
  if (/[\\$]/.test(text)) throw new Error('unhandled LaTeX in ' + context + ': ' + value);
  return text;
}

function initials(given) {
  return given.split(/\s+/).filter(Boolean).map(function (part) {
    return part.split('-').map(function (p) { return /\.$/.test(p) ? p : p[0] + '.'; }).join('-');
  }).join(' ');
}

function formatAuthors(raw, key) {
  return latexToText(raw, key + '.author').split(/\s+and\s+/).map(function (name) {
    const [last, given] = name.split(',').map(function (s) { return s.trim(); });
    return given ? last + ', ' + initials(given) : last;
  });
}

// ----------------------------------------------------------------- records

function linkFor(fields) {
  if (fields.doi) return 'https://doi.org/' + fields.doi;
  const arxiv = /arXiv:?\s*(\d{4}\.\d{4,5})/i.exec((fields.journal || '') + ' ' + (fields.note || '') + ' ' + (fields.eprint || ''));
  if (arxiv) return 'https://arxiv.org/abs/' + arxiv[1];
  return fields.url || null;
}

function toRecord(entry) {
  const f = entry.fields;
  const where = SECTIONS[entry.section];
  const title = latexToText(f.title, entry.key + '.title');
  const venueRaw = f.journal || f.booktitle || f.publisher || f.howpublished || '';
  const record = {
    id: entry.key,
    authors: formatAuthors(f.author || f.editor || '', entry.key),
    year: Number(f.year),
    title: title,
    venue: latexToText(venueRaw, entry.key + '.venue'),
    volume: f.volume || null,
    issue: f.number || null,
    pages: f.pages ? latexToText(f.pages, entry.key + '.pages') : null,
    doi: f.doi || null,
    link: linkFor(f),
    group: where.group,
    insertion: where.insertion,
    tags: TAG_RULES.filter(function (r) { return r[1].test(title.toLowerCase()); }).map(function (r) { return r[0]; }),
    verified: !entry.verify,
  };
  const problems = ['authors', 'title', 'venue'].filter(function (k) { return !record[k] || record[k].length === 0; });
  if (!Number.isInteger(record.year)) problems.push('year');
  if (problems.length) throw new Error(entry.key + ': missing ' + problems.join(', '));
  return record;
}

function main() {
  const bibPath = process.argv[2];
  if (!bibPath) {
    console.error('usage: node scripts/import-literature.js <references.bib>');
    process.exit(2);
  }
  const entries = parseBib(fs.readFileSync(bibPath, 'utf8')).filter(function (e) { return SECTIONS[e.section]; });
  const records = entries.map(toRecord).sort(function (a, b) { return a.year - b.year || a.id.localeCompare(b.id); });
  const counts = records.reduce(function (acc, r) { acc[r.group] = (acc[r.group] || 0) + 1; return acc; }, {});
  const payload = JSON.stringify({
    _about: 'Generated by scripts/import-literature.js from the author\'s thesis bibliography. ' +
      'Bibliographic fields only; tags are derived from titles by explicit keyword rules.',
    groups: {
      classical: 'Classical FWI',
      survey: 'Deep-learning FWI survey (16 papers)',
      'ml-native': 'Machine-learning-native line',
    },
    insertion: { model: 'Model side', data: 'Data side', prior: 'Prior side' },
    tags: TAG_RULES.map(function (r) { return r[0]; }),
    references: records,
  }, null, 2);
  fs.writeFileSync(OUT_JSON, payload + '\n');
  fs.writeFileSync(OUT_JS, '/* Generated by scripts/import-literature.js from literature.json; do not edit. */\n' +
    'window.FWI_DATA = window.FWI_DATA || {};\nwindow.FWI_DATA.literature = ' + payload + ';\n');
  console.log('wrote ' + records.length + ' references', counts,
    '(' + records.filter(function (r) { return !r.verified; }).length + ' not yet verified)');
}

if (require.main === module) main();
module.exports = { parseBib: parseBib, latexToText: latexToText, TAG_RULES: TAG_RULES };
