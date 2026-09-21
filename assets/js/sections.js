/*
 * Collapsible page sections (<details class="section">):
 *  - deep links: #some-id opens every section containing that element and
 *    scrolls to it (section ids, demo ids, bibliography entries);
 *  - opening a section records its id in the URL;
 *  - demos mount lazily with whenOpen() and pause with onClose();
 *  - expand-all / collapse-all buttons.
 */
(function (root) {
  'use strict';

  function sectionOf(node) {
    return node.closest('details.section');
  }

  // Run `fn` once, the first time the section containing `node` is open.
  function whenOpen(node, fn) {
    const section = sectionOf(node);
    if (!section || section.open) {
      fn();
      return;
    }
    section.addEventListener('toggle', function handler() {
      if (!section.open) return;
      section.removeEventListener('toggle', handler);
      fn();
    });
  }

  // Run `fn` every time the section containing `node` is closed.
  function onClose(node, fn) {
    const section = sectionOf(node);
    if (!section) return;
    section.addEventListener('toggle', function () {
      if (!section.open) fn();
    });
  }

  function reveal(id) {
    const target = id && document.getElementById(id);
    if (!target) return;
    for (let d = target.closest('details'); d; d = d.parentElement && d.parentElement.closest('details')) {
      d.open = true;
    }
    target.scrollIntoView({ block: 'start' });
    // Opening sections mounts their demos (toggle events run later), which can
    // add height above the target; scroll again once that has happened.
    setTimeout(function () {
      requestAnimationFrame(function () { target.scrollIntoView({ block: 'start' }); });
    }, 0);
  }

  function decodedHash() {
    try {
      return decodeURIComponent(window.location.hash.slice(1));
    } catch (e) {
      return '';
    }
  }

  document.addEventListener('click', function (event) {
    const link = event.target.closest('a[href^="#"]');
    if (!link) return;
    const id = link.getAttribute('href').slice(1);
    if (!document.getElementById(id)) return;
    event.preventDefault();
    history.pushState(null, '', '#' + id);
    reveal(id);
  });
  window.addEventListener('hashchange', function () { reveal(decodedHash()); });

  document.querySelectorAll('details.section').forEach(function (section) {
    section.addEventListener('toggle', function () {
      if (!section.open) return;
      const current = document.getElementById(decodedHash());
      if (!current || !section.contains(current)) history.replaceState(null, '', '#' + section.id);
    });
  });

  document.querySelectorAll('[data-sections]').forEach(function (button) {
    button.addEventListener('click', function () {
      const open = button.dataset.sections === 'expand';
      document.querySelectorAll('details.section').forEach(function (d) { d.open = open; });
    });
  });

  root.FWI = root.FWI || {};
  root.FWI.sections = { whenOpen: whenOpen, onClose: onClose };

  if (window.location.hash) reveal(decodedHash());
})(globalThis);
