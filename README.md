# FWI Explainer

An interactive, in-browser explainer of seismic Full-Waveform Inversion (FWI)
and deep-learning approaches to it. Everything runs client-side; the site is
plain HTML/CSS/JS with no build step and no network requests at runtime.

It is a single page (`index.html`) with collapsible sections: forward
modeling, the inverse problem, deep learning, research landscape, open
problems and references. Each interactive demo starts only when its section
is opened, and any section or reference can be linked directly
(e.g. `index.html#inverse-problem`).

> Status: in progress. Forward Modeling, The Inverse Problem and the Deep Learning comparison are live; the literature-driven modules are next.

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

Citations are links with a `data-cite="id"` attribute. The References
section is generated from them and from the reference data in `assets/data/`,
noting which section cites each entry:

```sh
node scripts/build-references.js          # regenerate the bibliography in index.html
node scripts/build-references.js --check  # fail if it is out of date
```

`assets/data/foundational-references.json` holds textbook-level references
(metadata checked against Crossref). The author's literature corpus will be
added as `assets/data/literature.json`. A test fails if any page cites an id
that is not in the data.

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
