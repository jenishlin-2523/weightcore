'use strict';
/*
 * accent.js — preset accent colours.
 *
 * Deliberately small: four presets that re-point the brand tokens in
 * accent.css, remembered per terminal in localStorage. The default is the
 * existing blue, so a station that never touches Settings sees no change.
 * Applied before first paint so there is no colour flash on load.
 */
(function () {
  const KEY = 'wc:accent';
  const PRESETS = [
    { v: '', t: 'Default blue', cls: 'accent--default' },
    { v: 'teal', t: 'Teal', cls: 'accent--teal' },
    { v: 'indigo', t: 'Indigo', cls: 'accent--indigo' },
    { v: 'amber', t: 'Amber', cls: 'accent--amber' }
  ];
  const valid = (v) => PRESETS.some(p => p.v === v);

  function get() {
    try { const v = localStorage.getItem(KEY) || ''; return valid(v) ? v : ''; }
    catch (e) { return ''; }                     // private window / storage blocked
  }
  function apply(v) {
    const root = document.documentElement;
    if (v) root.setAttribute('data-accent', v); else root.removeAttribute('data-accent');
  }
  function set(v) {
    if (!valid(v)) v = '';
    try { if (v) localStorage.setItem(KEY, v); else localStorage.removeItem(KEY); } catch (e) {}
    apply(v);
    window.dispatchEvent(new CustomEvent('wc:accent', { detail: v }));
  }

  apply(get());                                  // before first paint

  /* markup for the Settings row */
  function swatches() {
    const cur = get();
    return '<div class="accents" id="accentPick">' + PRESETS.map(p =>
      '<button type="button" class="accent ' + p.cls + (p.v === cur ? ' is-on' : '') +
      '" data-accent="' + p.v + '" title="' + p.t + '" aria-label="' + p.t + '"></button>').join('') + '</div>';
  }
  /* one delegated handler for wherever the swatches are rendered */
  document.addEventListener('click', (e) => {
    const b = e.target.closest && e.target.closest('[data-accent]');
    if (!b || !b.closest('#accentPick')) return;
    set(b.dataset.accent);
    b.closest('#accentPick').querySelectorAll('.accent')
      .forEach(x => x.classList.toggle('is-on', x === b));
  });

  window.WCAccent = { get, set, swatches, PRESETS };
})();
