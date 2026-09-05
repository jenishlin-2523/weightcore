'use strict';
/*
 * clock.js — analog clock-face time picker for WeighCore's renderer.
 *
 * Replaces the TIME half of every <input type="datetime-local"> (and any bare
 * <input type="time">) with an Android-style dial: click or drag on a circle,
 * hours first, then minutes in 5-minute steps, with a digital readout, AM/PM
 * toggle and Cancel/OK. The DATE half stays a normal native date input.
 *
 * Minimal-disruption by design: the ORIGINAL input element stays in the DOM,
 * keeps its id and keeps its value in exactly the format it always had
 * ("YYYY-MM-DDTHH:MM" for datetime-local, "HH:MM" for time). It is only hidden.
 * Everything downstream that reads U.$('#txnAt').value keeps working untouched,
 * and 'input'/'change' events are dispatched on it so existing listeners fire.
 *
 * Times are held internally as 24-hour HH:MM; only the DISPLAY is 12-hour.
 * No npm dependency — plain DOM, and the geometry is basic trigonometry.
 */
(function () {
  const P2 = (n) => (n < 10 ? '0' : '') + n;
  const DIAL = 260, R = 104, C = DIAL / 2;          // dial box, number radius, centre

  /* ---------- value helpers ---------- */
  const to12 = (h24) => ({ h: (h24 % 12) || 12, ap: h24 < 12 ? 'AM' : 'PM' });
  const to24 = (h12, ap) => (ap === 'PM' ? (h12 % 12) + 12 : (h12 % 12));
  const label12 = (h24, m) => { const t = to12(h24); return P2(t.h) + ':' + P2(m) + ' ' + t.ap; };

  /* split/join the host input's value without changing its format */
  function readVal(input) {
    const v = String(input.value || '');
    if (input.dataset.wcKind === 'time') {
      const m = /^(\d{1,2}):(\d{2})/.exec(v);
      return { date: '', h: m ? +m[1] : 0, m: m ? +m[2] : 0, had: !!m };
    }
    const m = /^(\d{4}-\d{2}-\d{2})[T ](\d{1,2}):(\d{2})/.exec(v);
    if (m) return { date: m[1], h: +m[2], m: +m[3], had: true };
    const d = /^(\d{4}-\d{2}-\d{2})/.exec(v);
    return { date: d ? d[1] : '', h: 0, m: 0, had: false };
  }
  function writeVal(input, date, h, m) {
    input.value = input.dataset.wcKind === 'time'
      ? P2(h) + ':' + P2(m)
      : (date || '') + 'T' + P2(h) + ':' + P2(m);
    input.dispatchEvent(new Event('input', { bubbles: true }));
    input.dispatchEvent(new Event('change', { bubbles: true }));
  }

  /* ---------- the popover ---------- */
  let openPop = null;
  function closePop(commit) {
    if (!openPop) return;
    const p = openPop; openPop = null;
    if (commit) p.commit();
    p.el.remove();
    document.removeEventListener('pointerdown', p.outside, true);
    document.removeEventListener('keydown', p.keys, true);
    window.removeEventListener('resize', p.reposition);
    window.removeEventListener('scroll', p.reposition, true);
  }

  function openClock(input, trigger) {
    closePop(false);
    const cur = readVal(input);
    const now = new Date();
    let h24 = cur.had ? cur.h : now.getHours();
    let mm = cur.had ? Math.round(cur.m / 5) * 5 % 60 : Math.round(now.getMinutes() / 5) * 5 % 60;
    let mode = 'h';                                    // 'h' then 'm'

    const el = document.createElement('div');
    el.className = 'wcclock';
    el.setAttribute('role', 'dialog');
    el.setAttribute('aria-label', 'Choose time');
    el.innerHTML =
      '<div class="wcclock__read">' +
        '<button type="button" class="wcclock__num" data-part="h"></button>' +
        '<span class="wcclock__colon">:</span>' +
        '<button type="button" class="wcclock__num" data-part="m"></button>' +
        '<div class="wcclock__ap">' +
          '<button type="button" class="wcclock__apb" data-ap="AM">AM</button>' +
          '<button type="button" class="wcclock__apb" data-ap="PM">PM</button>' +
        '</div>' +
      '</div>' +
      '<div class="wcclock__dial" style="width:' + DIAL + 'px;height:' + DIAL + 'px">' +
        '<div class="wcclock__hand"></div><div class="wcclock__hub"></div>' +
        '<div class="wcclock__marks"></div>' +
      '</div>' +
      '<div class="wcclock__foot">' +
        '<button type="button" class="btn btn--sm" data-cancel>Cancel</button>' +
        '<button type="button" class="btn btn--primary btn--sm" data-ok>OK</button>' +
      '</div>';
    document.body.appendChild(el);

    const marks = el.querySelector('.wcclock__marks');
    const hand = el.querySelector('.wcclock__hand');
    const hBtn = el.querySelector('[data-part="h"]');
    const mBtn = el.querySelector('[data-part="m"]');

    /* 12 positions, 12 at the top, going clockwise */
    function paintMarks() {
      const sel = mode === 'h' ? (to12(h24).h % 12) : (mm / 5) % 12;
      let html = '';
      for (let i = 0; i < 12; i++) {
        const rad = i * 30 * Math.PI / 180;
        const x = C + R * Math.sin(rad), y = C - R * Math.cos(rad);
        const txt = mode === 'h' ? (i === 0 ? 12 : i) : P2(i * 5);
        html += '<span class="wcclock__mark' + (i === sel ? ' is-on' : '') + '"' +
          ' style="left:' + x + 'px;top:' + y + 'px">' + txt + '</span>';
      }
      marks.innerHTML = html;
    }
    function paint() {
      const t = to12(h24);
      hBtn.textContent = P2(t.h); mBtn.textContent = P2(mm);
      hBtn.classList.toggle('is-on', mode === 'h');
      mBtn.classList.toggle('is-on', mode === 'm');
      el.querySelectorAll('.wcclock__apb').forEach(b =>
        b.classList.toggle('is-on', b.dataset.ap === t.ap));
      const idx = mode === 'h' ? (t.h % 12) : (mm / 5) % 12;
      hand.style.transform = 'rotate(' + (idx * 30) + 'deg)';
      paintMarks();
    }

    /* pointer position -> nearest of the 12 positions.
       angle 0 = 12 o'clock, increasing clockwise. */
    function idxAt(ev) {
      const r = el.querySelector('.wcclock__dial').getBoundingClientRect();
      const dx = ev.clientX - (r.left + C), dy = ev.clientY - (r.top + C);
      let deg = Math.atan2(dx, -dy) * 180 / Math.PI;
      if (deg < 0) deg += 360;
      return Math.round(deg / 30) % 12;
    }
    function applyIdx(i) {
      if (mode === 'h') {
        const t = to12(h24);
        h24 = to24(i === 0 ? 12 : i, t.ap);           // keep the current AM/PM
      } else {
        mm = (i * 5) % 60;
      }
      paint();
    }

    let dragging = false;
    const dial = el.querySelector('.wcclock__dial');
    dial.addEventListener('pointerdown', (ev) => {
      dragging = true;
      // capture keeps the drag alive past the dial's edge; harmless if the
      // pointer id isn't capturable (synthetic events), so never let it throw
      try { dial.setPointerCapture(ev.pointerId); } catch (e) {}
      applyIdx(idxAt(ev)); ev.preventDefault();
    });
    dial.addEventListener('pointermove', (ev) => { if (dragging) applyIdx(idxAt(ev)); });
    dial.addEventListener('pointerup', (ev) => {
      if (!dragging) return;
      dragging = false;
      applyIdx(idxAt(ev));
      // picking the hour rolls straight on to the minutes, like Android
      if (mode === 'h') { mode = 'm'; paint(); }
    });

    hBtn.addEventListener('click', () => { mode = 'h'; paint(); });
    mBtn.addEventListener('click', () => { mode = 'm'; paint(); });
    el.querySelectorAll('.wcclock__apb').forEach(b => b.addEventListener('click', () => {
      const t = to12(h24); h24 = to24(t.h, b.dataset.ap); paint();
    }));
    el.querySelector('[data-cancel]').addEventListener('click', () => closePop(false));
    el.querySelector('[data-ok]').addEventListener('click', () => closePop(true));

    const pop = {
      el,
      commit() {
        const v = readVal(input);
        writeVal(input, v.date || cur.date, h24, mm);
        if (trigger) trigger.textContent = label12(h24, mm);
      },
      outside(ev) { if (!el.contains(ev.target) && ev.target !== trigger) closePop(false); },
      keys(ev) {
        if (ev.key === 'Escape') { ev.stopPropagation(); ev.preventDefault(); closePop(false); }
        if (ev.key === 'Enter') { ev.stopPropagation(); ev.preventDefault(); closePop(true); }
      },
      reposition() {
        if (!trigger || !document.body.contains(trigger)) { closePop(false); return; }
        const r = trigger.getBoundingClientRect();
        const w = el.offsetWidth || 300, hgt = el.offsetHeight || 420;
        let left = Math.min(Math.max(8, r.left), window.innerWidth - w - 8);
        let top = r.bottom + 6;
        if (top + hgt > window.innerHeight - 8) top = Math.max(8, r.top - hgt - 6);
        el.style.left = left + 'px'; el.style.top = top + 'px';
      }
    };
    openPop = pop;
    paint(); pop.reposition();
    document.addEventListener('pointerdown', pop.outside, true);
    document.addEventListener('keydown', pop.keys, true);
    window.addEventListener('resize', pop.reposition);
    window.addEventListener('scroll', pop.reposition, true);
  }

  /* ---------- upgrade the inputs ---------- */
  function upgradeOne(input) {
    const kind = input.getAttribute('type') === 'time' ? 'time' : 'datetime';
    input.dataset.wcKind = kind;
    input.dataset.wcclock = '1';

    const wrap = document.createElement('div');
    wrap.className = 'wcdt' + (kind === 'time' ? ' wcdt--timeonly' : '');
    const v = readVal(input);

    let dateEl = null;
    if (kind === 'datetime') {
      dateEl = document.createElement('input');
      dateEl.type = 'date';
      dateEl.className = 'input wcdt__date';
      dateEl.value = v.date;
      if (input.disabled) dateEl.disabled = true;
      wrap.appendChild(dateEl);
    }

    const trigger = document.createElement('button');
    trigger.type = 'button';
    trigger.className = 'input wcdt__time';
    trigger.textContent = v.had ? label12(v.h, v.m) : '--:-- --';
    if (input.disabled) trigger.disabled = true;
    wrap.appendChild(trigger);

    input.parentNode.insertBefore(wrap, input);
    input.classList.add('wcdt__native');            // hidden, but still the value holder
    wrap.appendChild(input);

    if (dateEl) dateEl.addEventListener('change', () => {
      const cur = readVal(input);
      writeVal(input, dateEl.value, cur.h, cur.m);
    });
    trigger.addEventListener('click', (ev) => { ev.preventDefault(); ev.stopPropagation(); openClock(input, trigger); });
  }

  function upgrade(root) {
    const scope = root && root.querySelectorAll ? root : document;
    scope.querySelectorAll('input[type="datetime-local"]:not([data-wcclock]),input[type="time"]:not([data-wcclock])')
      .forEach(upgradeOne);
  }

  /* Views re-render constantly, so watch for new inputs instead of asking every
     call site to remember to upgrade. Debounced; the selector skips anything
     already upgraded, so a busy repaint costs one cheap query. */
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

  window.WCClock = { upgrade, open: openClock, close: () => closePop(false) };
})();
