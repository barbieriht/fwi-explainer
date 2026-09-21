/* Colour mapping shared by the simulation demos (canvas pixels, not CSS). */
(function (root) {
  'use strict';

  // Sequential three-stop ramp for velocity: slow = pale sand, fast = navy.
  const VELOCITY_STOPS = [[243, 231, 196], [86, 152, 163], [37, 52, 94]];
  // Diverging pair for signed wavefield amplitudes.
  const POS_RGB = [196, 58, 42];
  const NEG_RGB = [33, 94, 176];

  function velocityRgb(model, vmin, vmax) {
    const rgb = new Uint8ClampedArray(model.length * 3);
    for (let i = 0; i < model.length; i++) {
      const t = Math.min(1, Math.max(0, (model[i] - vmin) / (vmax - vmin)));
      const seg = t < 0.5 ? 0 : 1;
      const u = t < 0.5 ? t * 2 : (t - 0.5) * 2;
      const a = VELOCITY_STOPS[seg];
      const b = VELOCITY_STOPS[seg + 1];
      for (let c = 0; c < 3; c++) rgb[i * 3 + c] = a[c] + u * (b[c] - a[c]);
    }
    return rgb;
  }


  root.FWI = root.FWI || {};
  root.FWI.colormap = {
    POS_RGB: POS_RGB, NEG_RGB: NEG_RGB, velocityRgb: velocityRgb,
  };
})(globalThis);
