/*
 * Forward-modeling demo: paint a velocity model, place a source, and watch the
 * wavefield propagate while the receiver gather (shot record) builds up.
 * Depends on window.FWI.solver (solver.js).
 */
(function () {
  'use strict';

  const solver = window.FWI && window.FWI.solver;
  const colormap = window.FWI && window.FWI.colormap;
  const root = window.FWI && window.FWI.sections && document.getElementById('forward-demo');
  if (!solver || !colormap || !root) return;

  // Build the demo only when its section is first opened.
  window.FWI.sections.whenOpen(root, function mount() {
    const t = window.FWI.i18n.t;
    const num = window.FWI.i18n.num;
    const NX = 100;
    const NZ = 100;
    const DX = 10; // m
    const F0 = 15; // Hz, Ricker peak frequency
    const RECORD_SECONDS = 1.0;
    const VMIN = 1500; // m/s
    const VMAX = 4500; // m/s
    const RECEIVER_DEPTH = 2;
    const RECEIVER_SPACING = 2;
    const BRUSH_RADIUS = 4; // cells
    const STEP_BUTTON_STEPS = 10;
    const MODEL_CANVAS_PX = 500;
    const WAVE_CLIP_DECAY = 0.9;
    const WAVE_DISPLAY_GAIN = 1.3;
    // Never scale weaker than this fraction of the run's peak, so the faint
    // late-time coda fades out instead of being amplified to full colour.
    const WAVE_CLIP_FLOOR = 0.04;
    const DEFAULT_BRUSH_VELOCITY = 4000;

    // Fixed dt for the fastest paintable velocity, so edits never break stability.
    const DT = solver.stableDt(VMAX, DX);
    const NT = Math.ceil(RECORD_SECONDS / DT);
    const WAVELET = solver.ricker(F0, DT, NT);
    const RECEIVERS = [];
    for (let ix = 0; ix < NX; ix += RECEIVER_SPACING) RECEIVERS.push({ ix: ix, iz: RECEIVER_DEPTH });

    // ---------- velocity presets (each returns a fresh model) ----------

    function fillModel(fn) {
      const v = new Float32Array(NX * NZ);
      for (let iz = 0; iz < NZ; iz++) {
        for (let ix = 0; ix < NX; ix++) v[iz * NX + ix] = fn(ix, iz);
      }
      return v;
    }

    const PRESETS = {
      homogeneous: function () { return fillModel(function () { return 2000; }); },
      layered: function () {
        return fillModel(function (ix, iz) {
          if (iz < 35) return 1800;
          if (iz < 65) return 2600;
          return 3500;
        });
      },
      anomaly: function () {
        return fillModel(function (ix, iz) {
          const dx = ix - 50;
          const dz = iz - 55;
          return dx * dx + dz * dz < 15 * 15 ? 3800 : 2400;
        });
      },
      dipping: function () {
        return fillModel(function (ix, iz) {
          return iz > 30 + 0.4 * ix ? 3200 : 2000;
        });
      },
    };

    function paintDisc(model, cx, cz, value) {
      const next = Float32Array.from(model);
      for (let iz = Math.max(0, cz - BRUSH_RADIUS); iz <= Math.min(NZ - 1, cz + BRUSH_RADIUS); iz++) {
        for (let ix = Math.max(0, cx - BRUSH_RADIUS); ix <= Math.min(NX - 1, cx + BRUSH_RADIUS); ix++) {
          const d2 = (ix - cx) * (ix - cx) + (iz - cz) * (iz - cz);
          if (d2 <= BRUSH_RADIUS * BRUSH_RADIUS) next[iz * NX + ix] = value;
        }
      }
      return next;
    }

    // ---------- colour mapping ----------

    const POS_RGB = colormap.POS_RGB;
    const NEG_RGB = colormap.NEG_RGB;

    function velocityRgb(model) {
      return colormap.velocityRgb(model, VMIN, VMAX);
    }

    // ---------- DOM ----------

    const el = {
      model: root.querySelector('[data-role="model"]'),
      gather: root.querySelector('[data-role="gather"]'),
      preset: root.querySelector('[data-role="preset"]'),
      brush: root.querySelector('[data-role="brush"]'),
      brushValue: root.querySelector('[data-role="brush-value"]'),
      speed: root.querySelector('[data-role="speed"]'),
      play: root.querySelector('[data-role="play"]'),
      step: root.querySelector('[data-role="step"]'),
      reset: root.querySelector('[data-role="reset"]'),
      clock: root.querySelector('[data-role="clock"]'),
      status: root.querySelector('[data-role="status"]'),
      modes: root.querySelectorAll('input[name="fm-mode"]'),
    };

    el.model.width = MODEL_CANVAS_PX;
    el.model.height = MODEL_CANVAS_PX;
    el.gather.width = RECEIVERS.length;
    el.gather.height = NT;
    const modelCtx = el.model.getContext('2d');
    const gatherCtx = el.gather.getContext('2d');

    const frameCanvas = document.createElement('canvas');
    frameCanvas.width = NX;
    frameCanvas.height = NZ;
    const frameCtx = frameCanvas.getContext('2d');
    const frameImage = frameCtx.createImageData(NX, NZ);
    const gatherImage = gatherCtx.createImageData(RECEIVERS.length, NT);
    const wavefield = new Float32Array(NX * NZ);

    // ---------- state ----------

    const state = {
      model: PRESETS.layered(),
      colors: null,
      source: { ix: 50, iz: 3 },
      sim: null, // created lazily on first play/step
      playing: false,
      waveClip: 0,
      wavePeak: 0,
      gatherClip: 0,
      painting: false,
    };
    state.colors = velocityRgb(state.model);

    function newSimulation() {
      return solver.createSimulation({
        nx: NX, nz: NZ, dx: DX, dt: DT, nt: NT,
        velocity: state.model,
        sources: [{ ix: state.source.ix, iz: state.source.iz, wavelet: WAVELET }],
        receivers: RECEIVERS,
      });
    }

    function announce(text) {
      el.status.textContent = text;
    }

    // ---------- rendering ----------

    function frameMaxAbs(field) {
      let m = 0;
      for (let i = 0; i < field.length; i++) {
        const a = Math.abs(field[i]);
        if (a > m) m = a;
      }
      return m;
    }

    function drawModelFrame() {
      const data = frameImage.data;
      const hasField = state.sim !== null && state.sim.it > 0;
      if (hasField) {
        state.sim.readWavefield(wavefield);
        // Clip follows the current frame, decaying gently so it does not flicker.
        const frameMax = frameMaxAbs(wavefield);
        state.wavePeak = Math.max(state.wavePeak, frameMax);
        state.waveClip = Math.max(frameMax, state.waveClip * WAVE_CLIP_DECAY, state.wavePeak * WAVE_CLIP_FLOOR);
      }
      const scale = hasField && state.waveClip > 0 ? WAVE_DISPLAY_GAIN / state.waveClip : 0;
      for (let i = 0; i < NX * NZ; i++) {
        const amp = scale * wavefield[i];
        const alpha = hasField ? Math.min(1, Math.abs(amp)) : 0;
        const wave = amp >= 0 ? POS_RGB : NEG_RGB;
        for (let c = 0; c < 3; c++) {
          const base = state.colors[i * 3 + c];
          data[i * 4 + c] = base + alpha * (wave[c] - base);
        }
        data[i * 4 + 3] = 255;
      }
      frameCtx.putImageData(frameImage, 0, 0);
      modelCtx.imageSmoothingEnabled = true;
      modelCtx.drawImage(frameCanvas, 0, 0, MODEL_CANVAS_PX, MODEL_CANVAS_PX);
      drawAcquisition();
    }

    function drawAcquisition() {
      const cell = MODEL_CANVAS_PX / NX;
      modelCtx.fillStyle = '#1c1f24';
      RECEIVERS.forEach(function (r) {
        modelCtx.fillRect((r.ix + 0.5) * cell - 2, (r.iz + 0.5) * cell - 2, 4, 4);
      });
      const sx = (state.source.ix + 0.5) * cell;
      const sz = (state.source.iz + 0.5) * cell;
      modelCtx.beginPath();
      modelCtx.moveTo(sx, sz - 9);
      modelCtx.lineTo(sx + 8, sz + 6);
      modelCtx.lineTo(sx - 8, sz + 6);
      modelCtx.closePath();
      modelCtx.fillStyle = '#e8a33d';
      modelCtx.strokeStyle = '#1c1f24';
      modelCtx.lineWidth = 1.5;
      modelCtx.fill();
      modelCtx.stroke();
    }

    function drawGather() {
      const data = gatherImage.data;
      const nrec = RECEIVERS.length;
      const rows = state.sim ? state.sim.it : 0;
      const seis = state.sim ? state.sim.seismogram : null;
      // Linear time gain compensates geometric spreading for display only.
      let peak = 0;
      for (let it = 0; it < rows; it++) {
        const gain = 1 + (4 * it) / NT;
        for (let r = 0; r < nrec; r++) peak = Math.max(peak, Math.abs(seis[it * nrec + r] * gain));
      }
      state.gatherClip = peak * 0.25;
      for (let it = 0; it < NT; it++) {
        const gain = 1 + (4 * it) / NT;
        for (let r = 0; r < nrec; r++) {
          const p = (it * nrec + r) * 4;
          let rgb = [255, 255, 255];
          if (it < rows && state.gatherClip > 0) {
            const a = Math.max(-1, Math.min(1, (seis[it * nrec + r] * gain) / state.gatherClip));
            const target = a >= 0 ? POS_RGB : NEG_RGB;
            rgb = [0, 1, 2].map(function (c) { return 255 + Math.abs(a) * (target[c] - 255); });
          } else if (it >= rows) {
            rgb = [240, 240, 240];
          }
          data[p] = rgb[0];
          data[p + 1] = rgb[1];
          data[p + 2] = rgb[2];
          data[p + 3] = 255;
        }
      }
      gatherCtx.putImageData(gatherImage, 0, 0);
    }

    function drawClock() {
      const time = state.sim ? state.sim.it * DT : 0;
      el.clock.textContent = t('fm.clock', { t: num(time, 3), total: num(NT * DT, 2) });
    }

    function render() {
      drawModelFrame();
      drawGather();
      drawClock();
    }

    // ---------- simulation control ----------

    function ensureSimulation() {
      if (!state.sim) {
        state.sim = newSimulation();
        state.waveClip = 0;
        state.wavePeak = 0;
      }
      return state.sim;
    }

    function advance(steps) {
      const sim = ensureSimulation();
      for (let s = 0; s < steps && sim.step(); s++) { /* advance */ }
      if (sim.done) {
        setPlaying(false);
        announce(t('fm.finished'));
      }
    }

    function loop() {
      if (!state.playing) return;
      advance(Number(el.speed.value));
      render();
      requestAnimationFrame(loop);
    }

    function setPlaying(on) {
      state.playing = on;
      el.play.textContent = on ? t('common.pause') : t('common.play');
      el.play.setAttribute('aria-pressed', String(on));
      if (on) {
        if (state.sim && state.sim.done) state.sim = null;
        announce(t('fm.running'));
        requestAnimationFrame(loop);
      }
    }

    function resetSimulation(message) {
      setPlaying(false);
      state.sim = null;
      state.waveClip = 0;
      state.wavePeak = 0;
      wavefield.fill(0);
      render();
      announce(message);
    }

    // ---------- input ----------

    function currentMode() {
      const checked = Array.prototype.find.call(el.modes, function (m) { return m.checked; });
      return checked ? checked.value : 'source';
    }

    function cellFromPointer(event) {
      const rect = el.model.getBoundingClientRect();
      const ix = Math.floor(((event.clientX - rect.left) / rect.width) * NX);
      const iz = Math.floor(((event.clientY - rect.top) / rect.height) * NZ);
      return { ix: Math.min(NX - 1, Math.max(0, ix)), iz: Math.min(NZ - 1, Math.max(0, iz)) };
    }

    function applyPointer(event) {
      const cell = cellFromPointer(event);
      if (currentMode() === 'source') {
        state.source = cell;
        resetSimulation(t('fm.sourceMoved'));
        return;
      }
      state.model = paintDisc(state.model, cell.ix, cell.iz, Number(el.brush.value));
      state.colors = velocityRgb(state.model);
      if (state.sim) resetSimulation(t('fm.modelEdited'));
      else drawModelFrame();
    }

    el.model.addEventListener('pointerdown', function (event) {
      state.painting = currentMode() === 'paint';
      if (state.painting) el.model.setPointerCapture(event.pointerId);
      applyPointer(event);
    });
    el.model.addEventListener('pointermove', function (event) {
      if (state.painting) applyPointer(event);
    });
    ['pointerup', 'pointercancel'].forEach(function (type) {
      el.model.addEventListener(type, function () { state.painting = false; });
    });

    el.preset.addEventListener('change', function () {
      state.model = PRESETS[el.preset.value]();
      state.colors = velocityRgb(state.model);
      resetSimulation(t('fm.loaded', { name: el.preset.selectedOptions[0].textContent }));
    });
    el.brush.addEventListener('input', function () {
      el.brushValue.textContent = el.brush.value + ' m/s';
    });
    el.play.addEventListener('click', function () { setPlaying(!state.playing); });
    el.step.addEventListener('click', function () {
      setPlaying(false);
      if (state.sim && state.sim.done) state.sim = null;
      advance(STEP_BUTTON_STEPS);
      render();
    });
    el.reset.addEventListener('click', function () { resetSimulation(t('fm.reset')); });
    document.addEventListener('visibilitychange', function () {
      if (document.hidden) setPlaying(false);
    });

    el.brush.min = String(VMIN);
    el.brush.max = String(VMAX);
    el.brush.value = String(DEFAULT_BRUSH_VELOCITY);
    el.brushValue.textContent = el.brush.value + ' m/s';
    render();

    window.FWI.sections.onClose(root, function () { setPlaying(false); });
  });
})();
