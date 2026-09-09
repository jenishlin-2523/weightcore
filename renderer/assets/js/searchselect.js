'use strict';
/*
 * searchselect.js — type-to-search for long <select> dropdowns.
 *
 * The weighing form's master fields are already searchable comboboxes, but the
 * plain <select>s elsewhere (most visibly the report filter's Vehicle list,
 * which runs to hundreds of plates) could only be scrolled — typing did
 * nothing useful. This upgrades any select with more than THRESHOLD options
 * into a searchable combobox.
 *
 * Same non-invasive contract as clock.js: the ORIGINAL <select> stays in the
 * DOM, keeps its id, name and value, and gets 'input'/'change' dispatched on it
 * when the choice changes — so every existing reader and listener is untouched.
 * It is only hidden behind the search box.
 *
 * Small fixed dropdowns (Status, AM/PM, page size, …) are deliberately left
 * alone: a search box on four options is worse than the plain control.
 */
(function () {
  const THRESHOLD = 8;          // more options than this -> worth searching
  const MAXLIST = 60;           // rows rendered at once

  const esc = (s) => String(s == null ? '' : s)
    .replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

  function upgradeOne(sel) {
    sel.dataset.wcss = '1';

    const wrap = document.createElement('div');
    wrap.className = 'wcss';
    const box = document.createElement('input');
    box.type = 'text';
    box.className = 'input wcss__input';
    box.autocomplete = 'off';
    box.spellcheck = false;
    box.placeholder = sel.getAttribute('data-search-placeholder') || 'Type to search…';
    const menu = document.createElement('div');
    menu.className = 'wcss__menu';

    sel.parentNode.insertBefore(wrap, sel);
    wrap.appendChild(box);
    wrap.appendChild(menu);
    sel.classList.add('wcss__native');
    wrap.appendChild(sel);
    if (sel.disabled) box.disabled = true;

    const opts = () => Array.from(sel.options).map((o, i) => ({ i, v: o.value, t: o.textContent }));
    const showSelected = () => { box.value = sel.selectedIndex >= 0 ? sel.options[sel.selectedIndex].textContent : ''; };
    showSelected();

    let items = [], cursor = 0, open = false;
    const close = () => { open = false; wrap.classList.remove('is-open'); showSelected(); };

    function build() {
      const q = box.value.trim().toLowerCase();
      const all = opts();
      // when the box still shows the current selection, list everything
      const cur = sel.selectedIndex >= 0 ? sel.options[sel.selectedIndex].textContent.toLowerCase() : '';
      items = (q && q !== cur ? all.filter(o => o.t.toLowerCase().indexOf(q) >= 0) : all).slice(0, MAXLIST);
      if (cursor > items.length - 1) cursor = items.length - 1;
      if (cursor < 0) cursor = 0;
      menu.innerHTML = items.length
        ? items.map((o, n) => '<div class="wcss__opt' + (n === cursor ? ' is-cursor' : '') +
            (o.i === sel.selectedIndex ? ' is-on' : '') + '" data-n="' + n + '">' + esc(o.t) + '</div>').join('')
        : '<div class="wcss__empty">No match</div>';
      open = true; wrap.classList.add('is-open');
    }
    function choose(n) {
      const o = items[n]; if (!o) return;
      sel.selectedIndex = o.i;
      sel.dispatchEvent(new Event('input', { bubbles: true }));
      sel.dispatchEvent(new Event('change', { bubbles: true }));
      close();
    }

    box.addEventListener('focus', () => { box.select(); cursor = Math.max(0, sel.selectedIndex); build(); });
    box.addEventListener('input', () => { cursor = 0; build(); });
    box.addEventListener('keydown', (e) => {
      if (!open && (e.key === 'ArrowDown' || e.key === 'Enter')) { build(); return; }
      if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
        e.preventDefault();
        cursor = Math.max(0, Math.min(items.length - 1, cursor + (e.key === 'ArrowDown' ? 1 : -1)));
        build();
        const cur = menu.querySelector('.is-cursor'); if (cur && cur.scrollIntoView) cur.scrollIntoView({ block: 'nearest' });
        return;
      }
      if (e.key === 'Enter') { e.preventDefault(); choose(cursor); return; }
      if (e.key === 'Escape') { e.stopPropagation(); close(); return; }
    });
    menu.addEventListener('mousedown', (e) => {
      const o = e.target.closest('[data-n]'); if (!o) return;
      e.preventDefault(); choose(parseInt(o.dataset.n, 10));
    });
    document.addEventListener('pointerdown', (e) => { if (open && !wrap.contains(e.target)) close(); }, true);
    // keep the box in step if something else sets the value programmatically
    sel.addEventListener('change', () => { if (!open) showSelected(); });
  }

  function upgrade(root) {
    const scope = root && root.querySelectorAll ? root : document;
    scope.querySelectorAll('select:not([data-wcss]):not([data-nosearch])').forEach((sel) => {
      if (sel.multiple) return;                       // not the pattern this replaces
      if (sel.options.length <= THRESHOLD) return;    // small fixed lists stay as they are
      upgradeOne(sel);
    });
  }

  let pending = null;
  function schedule() {
    if (pending) return;
    pending = setTimeout(() => { pending = null; try { upgrade(document); } catch (e) {} }, 30);
  }
  function start() {
    upgrade(document);
    new MutationObserver(schedule).observe(document.body, { childList: true, subtree: true });
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start);
  else start();

  window.WCSearchSelect = { upgrade, THRESHOLD };
})();
