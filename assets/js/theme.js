/*
 * Light/dark theme. Loaded in <head> without defer so the saved choice is
 * applied before first paint. With no saved choice the page follows the OS
 * setting (see theme.css). The toggle button carries its own accessible
 * labels (data-label-light / data-label-dark), so each language page
 * supplies them.
 */
(function () {
  'use strict';

  const STORAGE_KEY = 'fwi-theme';
  const root = document.documentElement;
  const media = window.matchMedia ? window.matchMedia('(prefers-color-scheme: dark)') : null;

  function saved() {
    try {
      const value = window.localStorage.getItem(STORAGE_KEY);
      return value === 'light' || value === 'dark' ? value : null;
    } catch (e) {
      return null; // storage blocked (private mode, file://, settings)
    }
  }

  function save(value) {
    try {
      window.localStorage.setItem(STORAGE_KEY, value);
    } catch (e) {
      /* the choice still applies for this page view */
    }
  }

  function current() {
    return root.dataset.theme || (media && media.matches ? 'dark' : 'light');
  }

  const initial = saved();
  if (initial) root.dataset.theme = initial;

  function sync(button) {
    const next = current() === 'dark' ? 'light' : 'dark';
    button.setAttribute('aria-label', button.dataset['label' + (next === 'dark' ? 'Dark' : 'Light')]);
    button.setAttribute('title', button.getAttribute('aria-label'));
    button.dataset.next = next;
  }

  document.addEventListener('DOMContentLoaded', function () {
    const button = document.querySelector('[data-theme-toggle]');
    if (!button) return;
    sync(button);
    button.addEventListener('click', function () {
      const next = button.dataset.next;
      root.dataset.theme = next;
      save(next);
      sync(button);
      document.dispatchEvent(new CustomEvent('fwi:themechange', { detail: { theme: next } }));
    });
    if (media && media.addEventListener) {
      media.addEventListener('change', function () { if (!root.dataset.theme) sync(button); });
    }
  });
})();
