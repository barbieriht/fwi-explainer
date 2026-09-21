/* Render inline \( \) and display \[ \] math with the vendored KaTeX. */
(function () {
  'use strict';
  if (typeof window.renderMathInElement !== 'function') return;
  window.renderMathInElement(document.getElementById('content') || document.body, {
    delimiters: [
      { left: '\\[', right: '\\]', display: true },
      { left: '\\(', right: '\\)', display: false },
    ],
    throwOnError: false,
  });
})();
