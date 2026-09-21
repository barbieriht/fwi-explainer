# FWI Explainer

**Live: https://barbieriht.github.io/fwi-explainer/** · [Português](https://barbieriht.github.io/fwi-explainer/index.pt.html)

An interactive, in-browser explainer of seismic Full-Waveform Inversion (FWI)
and deep-learning approaches to it. The wave simulations and the inversion
run live in the browser; there is no backend, no build step and no network
request at runtime. Built as part of ongoing PhD research in AI at the
University of São Paulo (USP).

![The page with its collapsible sections](assets/img/readme/overview.png)

## What is inside

- **Forward modeling.** A 2D acoustic finite-difference solver: paint a
  velocity model, place the source, and watch the wavefield and the shot
  gather build up.
- **The inverse problem.** Adjoint-state FWI in the browser. A misfit
  landscape and four inversion scenarios show cycle-skipping, and two ways
  around it.
- **Deep learning.** Classical FWI, a trained network and a DL + FWI hybrid,
  compared offline on a laptop GPU, including a case where the network fails
  on unfamiliar geology.
- **Research landscape.** A snapshot of the studies collected through the
  author's database searches (clearly labeled as unscreened), and a short
  curated reading list.
- **Open problems, references.** Built from the author's bibliography, with
  every citation resolving to a real entry.

| Forward modeling | Cycle-skipping |
|---|---|
| ![Wavefield and shot gather](assets/img/readme/forward-modeling.png) | ![Inversion stuck in a local minimum](assets/img/readme/cycle-skipping.png) |

## How the page is organized

A single page with collapsible sections. Each demo starts only when its
section is opened and pauses when it is closed. Any section or reference can
be linked directly (e.g. `index.html#inverse-problem`). The header has an
EN/PT language switch, which keeps the current section, and a light/dark
theme toggle, which defaults to the system setting.

The two languages are two files, `index.html` and `index.pt.html`, maintained
side by side: edit the prose in both and keep their structure identical
(tests compare ids, controls, scripts and citations). Strings produced by the
demos at runtime live in `assets/js/i18n.js`.

## Run locally

Clone the repository and open `index.html` in a browser; nothing needs to be
installed. Or serve the folder:

```sh
python3 -m http.server 8000   # then visit http://localhost:8000
```

## Tests

```sh
node --test
```

Node 18+ and no dependencies. The tests cover the wave solver (stability,
arrival times, absorbing boundaries), the inversion (the adjoint-state
gradient is checked against finite differences to within 1%), the literature
data, the generated page content and the parity of the two language versions.

## Content pipeline

The literature on the page comes from the author's thesis bibliography, never
from hand-typed entries:

```sh
# 1. Import the corpus (classical FWI, the 16-paper deep-learning FWI survey,
#    and the machine-learning-oriented line) from the thesis .bib
node scripts/import-literature.js "/path/to/Overleaf Project/references.bib"

# 2. Fill the generated parts of index.html and index.pt.html
node scripts/build-page.js          # rewrite
node scripts/build-page.js --check  # fail if out of date (also a test)
```

- `import-literature.js` copies bibliographic fields only (the .bib's working
  comments are never read), marks entries with a `% VERIFY` note as not yet
  verified, and derives topic tags from titles with explicit keyword rules.
  It writes `assets/data/literature.json`, which `build-page.js` reads, so
  the published page needs no runtime data file for the literature.
- In both pages, prose is hand-written. Lists of papers are written as
  `<span class="cite-list" data-cite-list="tag=uncertainty">` and inline
  citations as `<a class="cite" data-cite="id">`. `build-page.js` fills
  both from the data, then generates the References section, listing
  every cited entry and the sections citing it.
- `assets/data/foundational-references.json` holds the few textbook
  references that are not in the thesis bibliography.

Tests fail if a citation does not resolve, if a tag does not follow from its
title, if either page is out of date, or if the two language versions drift
apart structurally.

### Search snapshot (Research landscape)

```sh
cp ~/Zotero/zotero.sqlite /tmp/zotero-copy.sqlite   # Zotero locks the live file
python3 scripts/import-zotero.py /tmp/zotero-copy.sqlite --collection Seismic
```

Reads the collection and its sub-collections (except `Removed`), removes
duplicates by DOI or title, and flags studies that mention machine learning
or deep learning with a keyword rule on title and abstract. Only aggregate
counts are written, to
`assets/data/search-snapshot.{json,js}`; no per-study field is published.

### Curated readings

`content/readings.csv` lists candidate readings: `id` from the reference data,
page `group`, the `source` the sentence is based on, `approved`, a written
`review` of the decision, and one sentence in English and Portuguese that
restates the paper's abstract. The selection criterion is whether the
abstract shows the paper is about FWI methods. Approved rows are ranked by
citations per year since publication:

```sh
python3 scripts/update-citations.py   # OpenAlex counts -> content/citations.json
node scripts/build-page.js
```

## Deep-learning comparison (offline)

The deep-learning section compares three methods on one familiar and one
unfamiliar velocity model: classical FWI from a smooth 1D start, a trained
data-to-model network, and **DL + FWI**, a short FWI run (60 iterations)
that starts from the network's prediction. Everything is generated locally
with PyTorch on a consumer GPU; no cloud services are involved. Outputs that
are committed: `assets/img/dl/*.png` and `assets/data/dl-comparison.{json,js}`.

```sh
cd scripts/dl
python3 generate_dataset.py --out ../../data-src/dl                         # 8k training samples
python3 generate_dataset.py --out ../../data-src/dl --append 8000 --seed 7  # grow to 16k
python3 train.py --data ../../data-src/dl --epochs 50 --ema 0.999 --amp     # final recipe
python3 compare.py --data ../../data-src/dl                                 # FWI, network, DL + FWI
python3 compare.py --data ../../data-src/dl --model model-baseline.pt --eval-only   # test-set MAE only
```

Cheap improvements were tested one at a time (every run is logged in
`data-src/dl/ablations.json`; validation MAE on 400 held-out models):

| Run | Validation MAE |
|---|---|
| Baseline: L1 loss, 8k samples, 60 epochs | 59.1 m/s |
| + signed-log input compression + edge-aware loss | 62.5 m/s (worse) |
| + input compression only | 60.0 m/s (no gain) |
| **16k samples + EMA of weights, 50 epochs** | **49.0 m/s** |

The final network lowers the test-set error from 62 to 50 m/s. The
unfamiliar-geology case stays out of reach for the network alone, by design:
the generator never produces its features.

`data-src/` (dataset and checkpoints) is git-ignored. The simulator in
`scripts/dl/common.py` uses the same scheme as the browser solver and matches
it to within 1e-5 relative error.

## Developed with Claude Code

This repository was developed with the assistance of
[Claude Code](https://claude.com/claude-code), Anthropic's AI coding agent,
under the author's direction and review. Commits made with its help carry a
`Co-Authored-By: Claude` trailer.

## Credits

- Standard numerical methods (finite-difference time-domain wave simulation,
  adjoint-state gradients, sponge boundaries, multiscale inversion) are
  cited on the page where they are introduced.
- No figure, table or text is reproduced from any paper; every visual is
  computed from the equations or from the author's own experiments.

## Third-party code

Vendored in `assets/vendor/` with their licenses:

- [D3](https://d3js.org) v7.9.0 — ISC
- [KaTeX](https://katex.org) v0.16.47 — MIT

## License

MIT — see [LICENSE](LICENSE).
