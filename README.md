# FWI Explainer

An interactive, in-browser explainer of seismic Full-Waveform Inversion (FWI)
and deep-learning approaches to it. Everything runs client-side; the site is
plain HTML/CSS/JS with no build step and no network requests at runtime.

It is a single page (`index.html`) with collapsible sections: forward
modeling, the inverse problem, deep learning, research landscape, open
problems and references. Each interactive demo starts only when its section
is opened, and any section or reference can be linked directly
(e.g. `index.html#inverse-problem`).

> Status: all sections are live; polishing is in progress.

## Run locally

Open `index.html` in a browser, or serve the folder:

```sh
python3 -m http.server 8000   # then visit http://localhost:8000
```

## Tests

```sh
node --test
```

Unit tests cover the wave solver (stability, arrival times, absorbing
boundaries) and the inversion (the adjoint-state gradient is checked against
finite differences to within 1%). No dependencies to install; Node 18+.

## Content pipeline

The literature on the page comes from the author's thesis bibliography, never
from hand-typed entries:

```sh
# 1. Import the corpus (classical FWI, the 16-paper deep-learning FWI survey,
#    and the machine-learning-oriented line) from the thesis .bib
node scripts/import-literature.js "/path/to/Overleaf Project/references.bib"

# 2. Fill the generated parts of index.html
node scripts/build-page.js          # rewrite
node scripts/build-page.js --check  # fail if out of date (also a test)
```

- `import-literature.js` copies bibliographic fields only (the .bib's working
  comments are never read), marks entries with a `% VERIFY` note as not yet
  verified, and derives topic tags from titles with explicit keyword rules.
  It writes `assets/data/literature.json` and a `literature.js` twin, so the
  page also works when opened from disk.
- In `index.html`, prose is hand-written. Lists of papers are written as
  `<span class="cite-list" data-cite-list="tag=uncertainty">` and inline
  citations as `<a class="cite" data-cite="id">`. `build-page.js` fills
  both from the data, then generates the References section, listing
  every cited entry and the sections citing it.
- `assets/data/foundational-references.json` holds the few textbook
  references that are not in the thesis bibliography.

Tests fail if a citation does not resolve, if a tag does not follow from its
title, or if `index.html` is out of date.

## Deep-learning comparison (offline)

The deep-learning section shows one pre-computed comparison between classical FWI
and a trained network. Everything is generated locally with PyTorch on a
consumer GPU; no cloud services are involved. Outputs that are committed:
`assets/img/dl/*.png` and `assets/data/dl-comparison.{json,js}`.

```sh
cd scripts/dl
python3 generate_dataset.py --out ../../data-src/dl   # synthetic models + shot gathers (~10 min)
python3 train.py --data ../../data-src/dl             # encoder-decoder network
python3 compare.py --data ../../data-src/dl           # classical FWI vs network, writes site assets
```

`data-src/` (dataset and checkpoints) is git-ignored. The simulator in
`scripts/dl/common.py` uses the same scheme as the browser solver and matches
it to within 1e-5 relative error.

## Third-party code

Vendored in `assets/vendor/` with their licenses:

- [D3](https://d3js.org) v7.9.0 — ISC
- [KaTeX](https://katex.org) v0.16.47 — MIT

## License

MIT — see [LICENSE](LICENSE).
