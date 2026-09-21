# FWI Explainer

An interactive, in-browser explainer of seismic Full-Waveform Inversion (FWI)
and deep-learning approaches to it. Everything runs client-side; the site is
plain HTML/CSS/JS with no build step and no network requests at runtime.

> Status: in progress. Forward Modeling and The Inverse Problem are live; other modules are being added phase by phase.

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

## Third-party code

Vendored in `assets/vendor/` with their licenses:

- [D3](https://d3js.org) v7.9.0 — ISC
- [KaTeX](https://katex.org) v0.16.47 — MIT

## License

MIT — see [LICENSE](LICENSE).
