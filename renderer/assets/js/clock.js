'use strict';
/*
 * clock.js — date + time entry for WeighCore's renderer.
 *
 * Replaces every <input type="datetime-local"> (and any bare <input type="time">)
 * with two controls of our own:
 *
 *   DATE — a trigger showing DD/MM/YYYY that opens a small month calendar.
 *          The native <input type="date"> renders in the OS locale, which on
 *          this site shows MM/DD/YYYY and is genuinely ambiguous on a weighment
 *          slip, and Chromium gives no way to force a format per field. So the
 *          field is ours, exactly like the clock below.
 *
 *   TIME — an Android-style dial: click or drag, hours first then 5-minute
 *          steps. The digits above the dial are real inputs, so any minute can
 *          be TYPED (a dial drag can only land on multiples of 5 — 09:07 is
 *          impossible by dragging). The hand follows a typed value exactly and
 *          may point between the tick marks, like a real clock.
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
  const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June',
                  'July', 'August', 'September', 'October', 'November', 'December'];

  /* ---------- value helpers ---------- */
  const to12 = (h24) => ({ h: (h24 % 12) || 12, ap: h24 < 12 ? 'AM' : 'PM' });
  const to24 = (h12, ap) => (ap === 'PM' ? (h12 % 12) + 12 : (h12 % 12));
  const label12 = (h24, m) => { const t = to12(h24); return P2(t.h) + ':' + P2(m) + ' ' + t.ap; };
  /* DD/MM/YYYY for display; the stored value stays ISO YYYY-MM-DD */
  const labelDate = (iso) => {
    const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(iso || ''));
    return m ? m[3] + '/' + m[2] + '/' + m[1] : '';
  };
  const isoOf = (d) => d.getFullYear() + '-' + P2(d.getMonth() + 1) + '-' + P2(d.getDate());

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

  /* ---------- shared popover plumbing ---------- */
  let openPop = null;
  function closePop(commit) {
    if (!openPop) return;
    const p = openPop; openPop = null;
    if (commit && p.commit) p.commit();
    p.el.remove();
    document.removeEventListener('pointerdown', p.outside, true);
    document.removeEventListener('keydown', p.keys, true);
    window.removeEventListener('resize', p.reposition);
    window.removeEventListener('scroll', p.reposition, true);
  }
  function anchor(el, trigger) {
    return function reposition() {
      if (!trigger || !document.body.contains(trigger)) { closePop(false); return; }
      const r = trigger.getBoundingClientRect();
      const w = el.offsetWidth || 300, hgt = el.offsetHeight || 380;
      const left = Math.min(Math.max(8, r.left), window.innerWidth - w - 8);
      let top = r.bottom + 6;
      if (top + hgt > window.innerHeight - 8) top = Math.max(8, r.top - hgt - 6);
      el.style.left = left + 'px'; el.style.top = top + 'px';
    };
  }
  function register(el, trigger, commit, onKey) {
    const pop = {
      el, commit,
      outside(ev) { if (!el.contains(ev.target) && ev.target !== trigger) closePop(false); },
      keys(ev) {
        if (onKey && onKey(ev) === true) return;
        if (ev.key === 'Escape') { ev.stopPropagation(); ev.preventDefault(); closePop(false); }
      },
      reposition: anchor(el, trigger)
    };
    openPop = pop;
    pop.reposition();
    document.addEventListener('pointerdown', pop.outside, true);
    document.addEventListener('keydown', pop.keys, true);
    window.addEventListener('resize', pop.reposition);
    window.addEventListener('scroll', pop.reposition, true);
    return pop;
  }

  /* ======================================================================
     DATE — month calendar, DD/MM/YYYY
     ====================================================================== */
  function openCalendar(input, trigger) {
    closePop(false);
    const cur = readVal(input);
    const today = new Date();
    let sel = cur.date ? new Date(cur.date + 'T00:00:00') : new Date(today);
    if (isNaN(sel)) sel = new Date(today);
    let view = new Date(sel.getFullYear(), sel.getMonth(), 1);

    const el = document.createElement('div');
    el.className = 'wccal';
    el.setAttribute('role', 'dialog');
    el.setAttribute('aria-label', 'Choose date');
    el.innerHTML =
      '<div class="wccal__head">' +
        '<button type="button" class="wccal__nav" data-mv="-1" aria-label="Previous month">&#8249;</button>' +
        '<div class="wccal__title"></div>' +
        '<button type="button" class="wccal__nav" data-mv="1" aria-label="Next month">&#8250;</button>' +
      '</div>' +
      '<div class="wccal__dow"><span>Mo</span><span>Tu</span><span>We</span><span>Th</span><span>Fr</span><span>Sa</span><span>Su</span></div>' +
      '<div class="wccal__grid"></div>' +
      '<div class="wccal__foot">' +
        '<button type="button" class="btn btn--sm" data-today>Today</button>' +
        '<div class="spacer"></div>' +
        '<button type="button" class="btn btn--sm" data-cancel>Cancel</button>' +
      '</div>';
    document.body.appendChild(el);

    const title = el.querySelector('.wccal__title');
    const grid = el.querySelector('.wccal__grid');

    function paint() {
      title.textContent = MONTHS[view.getMonth()] + ' ' + view.getFullYear();
      // Monday-first grid, matching how the site writes dates
      const first = new Date(view.getFullYear(), view.getMonth(), 1);
      let lead = (first.getDay() + 6) % 7;
      const days = new Date(view.getFullYear(), view.getMonth() + 1, 0).getDate();
      let html = '';
      for (let i = 0; i < lead; i++) html += '<span class="wccal__d wccal__d--pad"></span>';
      for (let d = 1; d <= days; d++) {
        const iso = view.getFullYear() + '-' + P2(view.getMonth() + 1) + '-' + P2(d);
        const isSel = cur.date ? iso === cur.date : false;
        const isToday = iso === isoOf(today);
        html += '<button type="button" class="wccal__d' + (isSel ? ' is-on' : '') +
          (isToday ? ' is-today' : '') + '" data-iso="' + iso + '">' + d + '</button>';
      }
      grid.innerHTML = html;
    }
    paint();

    el.addEventListener('click', (ev) => {
      const mv = ev.target.closest('[data-mv]');
      if (mv) { view = new Date(view.getFullYear(), view.getMonth() + Number(mv.dataset.mv), 1); paint(); return; }
      if (ev.target.closest('[data-cancel]')) { closePop(false); return; }
      const td = ev.target.closest('[data-today]');
      const d = ev.target.closest('[data-iso]');
      const iso = td ? isoOf(today) : (d ? d.dataset.iso : null);
      if (!iso) return;
      const v = readVal(input);
      writeVal(input, iso, v.h, v.m);
      if (trigger) trigger.textContent = labelDate(iso);
      closePop(false);
    });

    register(el, trigger, null, null);
  }

  /* ======================================================================
     TIME — dial + typeable digits
     ====================================================================== */
  function openClock(input, trigger) {
    closePop(false);
    const cur = readVal(input);
    const now = new Date();
    let h24 = cur.had ? cur.h : now.getHours();
    let mm = cur.had ? cur.m : now.getMinutes();
    let mode = 'h';                                    // 'h' then 'm'

    const el = document.createElement('div');
    el.className = 'wcclock';
    el.setAttribute('role', 'dialog');
    el.setAttribute('aria-label', 'Choose time');
    el.innerHTML =
      '<div class="wcclock__read">' +
        '<input class="wcclock__num" data-part="h" inputmode="numeric" maxlength="2" aria-label="Hour">' +
        '<span class="wcclock__colon">:</span>' +
        '<input class="wcclock__num" data-part="m" inputmode="numeric" maxlength="2" aria-label="Minute">' +
        '<div class="wcclock__ap">' +
          '<button type="button" class="wcclock__apb" data-ap="AM">AM</button>' +
          '<button type="button" class="wcclock__apb" data-ap="PM">PM</button>' +
        '</div>' +
      '</div>' +
      '<div class="wcclock__dial" style="width:' + DIAL + 'px;height:' + DIAL + 'px">' +
        '<div class="wcclock__hand"></div><div class="wcclock__hub"></div>' +
        '<div class="wcclock__marks"></div>' +
      '</div>' +
      '<div class="wcclock__hint">Drag the dial for 5-minute steps, or type any minute above.</div>' +
      '<div class="wcclock__foot">' +
        '<button type="button" class="btn btn--sm" data-cancel>Cancel</button>' +
        '<button type="button" class="btn btn--primary btn--sm" data-ok>OK</button>' +
      '</div>';
    document.body.appendChild(el);

    const marks = el.querySelector('.wcclock__marks');
    const hand = el.querySelector('.wcclock__hand');
    const hBox = el.querySelector('[data-part="h"]');
    const mBox = el.querySelector('[data-part="m"]');

    /* 12 positions, 12 at the top, going clockwise */
    function paintMarks() {
      // highlight a number only when the value lands exactly on it, so a typed
      // 09:07 highlights nothing while the hand still points at 07
      const exact = mode === 'h' ? (to12(h24).h % 12) : (mm % 5 === 0 ? (mm / 5) % 12 : -1);
      let html = '';
      for (let i = 0; i < 12; i++) {
        const rad = i * 30 * Math.PI / 180;
        const x = C + R * Math.sin(rad), y = C - R * Math.cos(rad);
        const txt = mode === 'h' ? (i === 0 ? 12 : i) : P2(i * 5);
        html += '<span class="wcclock__mark' + (i === exact ? ' is-on' : '') + '"' +
          ' style="left:' + x + 'px;top:' + y + 'px">' + txt + '</span>';
      }
      marks.innerHTML = html;
    }
    /* the hand points at the EXACT value — 30 degrees per hour, 6 per minute —
       so a typed 07 minutes sits between the 05 and 10 marks, like a real clock */
    function handAngle() {
      return mode === 'h' ? (to12(h24).h % 12) * 30 : mm * 6;
    }
    function paint(skipBoxes) {
      const t = to12(h24);
      if (!skipBoxes || document.activeElement !== hBox) hBox.value = P2(t.h);
      if (!skipBoxes || document.activeElement !== mBox) mBox.value = P2(mm);
      hBox.classList.toggle('is-on', mode === 'h');
      mBox.classList.toggle('is-on', mode === 'm');
      el.querySelectorAll('.wcclock__apb').forEach(b =>
        b.classList.toggle('is-on', b.dataset.ap === t.ap));
      hand.style.transform = 'rotate(' + handAngle() + 'deg)';
      paintMarks();
    }

    /* pointer position -> nearest of the 12 positions (5-minute granularity) */
    function idxAt(ev) {
      const r = el.querySelector('.wcclock__dial').getBoundingClientRect();
      const dx = ev.clientX - (r.left + C), dy = ev.clientY - (r.top + C);
      let deg = Math.atan2(dx, -dy) * 180 / Math.PI;
      if (deg < 0) deg += 360;
      return Math.round(deg / 30) % 12;
    }
    function applyIdx(i) {
      if (mode === 'h') h24 = to24(i === 0 ? 12 : i, to12(h24).ap);
      else mm = (i * 5) % 60;
      paint();
    }

    let dragging = false;
    const dial = el.querySelector('.wcclock__dial');
    dial.addEventListener('pointerdown', (ev) => {
      dragging = true;
      try { dial.setPointerCapture(ev.pointerId); } catch (e) {}
      applyIdx(idxAt(ev)); ev.preventDefault();
    });
    dial.addEventListener('pointermove', (ev) => { if (dragging) applyIdx(idxAt(ev)); });
    dial.addEventListener('pointerup', (ev) => {
      if (!dragging) return;
      dragging = false;
      applyIdx(idxAt(ev));
      if (mode === 'h') { mode = 'm'; mBox.focus(); mBox.select(); paint(); }
    });

    /* ---- typing ---- */
    /* Clicking, focusing OR typing in a box selects that field — the dial then
       shows and drives that half. Typing is the decisive one: it must work even
       where a synthetic focus never fired. */
    const setMode = (m) => { if (mode === m) return; mode = m; paint(true); };
    hBox.addEventListener('focus', () => { setMode('h'); hBox.select(); });
    mBox.addEventListener('focus', () => { setMode('m'); mBox.select(); });
    hBox.addEventListener('click', () => setMode('h'));
    mBox.addEventListener('click', () => setMode('m'));

    hBox.addEventListener('input', () => {
      setMode('h');
      const digits = hBox.value.replace(/\D/g, '').slice(0, 2);
      hBox.value = digits;
      const n = parseInt(digits, 10);
      if (!isFinite(n) || n < 1 || n > 12) return;          // wait for a valid 1-12
      h24 = to24(n, to12(h24).ap);
      paint(true);
      // two digits typed, or a value that can't grow into a valid hour -> minutes
      if (digits.length === 2 || n > 1) { mode = 'm'; paint(true); mBox.focus(); mBox.select(); }
    });
    mBox.addEventListener('input', () => {
      setMode('m');
      const digits = mBox.value.replace(/\D/g, '').slice(0, 2);
      mBox.value = digits;
      const n = parseInt(digits, 10);
      if (!isFinite(n) || n < 0 || n > 59) return;
      mm = n;                                               // ANY minute, not just multiples of 5
      paint(true);
    });
    const normalise = () => {
      const hn = parseInt(hBox.value, 10);
      if (isFinite(hn) && hn >= 1 && hn <= 12) h24 = to24(hn, to12(h24).ap);
      const mn = parseInt(mBox.value, 10);
      if (isFinite(mn) && mn >= 0 && mn <= 59) mm = mn;
      paint();
    };
    hBox.addEventListener('blur', normalise);
    mBox.addEventListener('blur', normalise);

    el.querySelectorAll('.wcclock__apb').forEach(b => b.addEventListener('click', () => {
      h24 = to24(to12(h24).h, b.dataset.ap); paint();
    }));
    el.querySelector('[data-cancel]').addEventListener('click', () => closePop(false));
    el.querySelector('[data-ok]').addEventListener('click', () => closePop(true));

    const commit = () => {
      normalise();
      const v = readVal(input);
      writeVal(input, v.date || cur.date, h24, mm);
      if (trigger) trigger.textContent = label12(h24, mm);
    };
    register(el, trigger, commit, (ev) => {
      if (ev.key !== 'Enter') return false;
      ev.stopPropagation(); ev.preventDefault();
      // Enter in the hour moves to the minute; Enter in the minute commits
      if (document.activeElement === hBox) { normalise(); mode = 'm'; paint(); mBox.focus(); mBox.select(); return true; }
      closePop(true);
      return true;
    });
    paint();
    hBox.focus(); hBox.select();
  }

  /* ---------- upgrade the inputs ---------- */
  function upgradeOne(input) {
    const kind = input.getAttribute('type') === 'time' ? 'time' : 'datetime';
    input.dataset.wcKind = kind;
    input.dataset.wcclock = '1';

    const wrap = document.createElement('div');
    wrap.className = 'wcdt' + (kind === 'time' ? ' wcdt--timeonly' : '');
    const v = readVal(input);

    let dateBtn = null;
    if (kind === 'datetime') {
      dateBtn = document.createElement('button');
      dateBtn.type = 'button';
      dateBtn.className = 'input wcdt__date';
      dateBtn.textContent = v.date ? labelDate(v.date) : 'DD/MM/YYYY';
      if (input.disabled) dateBtn.disabled = true;
      wrap.appendChild(dateBtn);
    }

    const timeBtn = document.createElement('button');
    timeBtn.type = 'button';
    timeBtn.className = 'input wcdt__time';
    timeBtn.textContent = v.had ? label12(v.h, v.m) : '--:-- --';
    if (input.disabled) timeBtn.disabled = true;
    wrap.appendChild(timeBtn);

    input.parentNode.insertBefore(wrap, input);
    input.classList.add('wcdt__native');            // hidden, but still the value holder
    wrap.appendChild(input);

    if (dateBtn) dateBtn.addEventListener('click', (ev) => {
      ev.preventDefault(); ev.stopPropagation(); openCalendar(input, dateBtn);
    });
    timeBtn.addEventListener('click', (ev) => {
      ev.preventDefault(); ev.stopPropagation(); openClock(input, timeBtn);
    });
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

  window.WCClock = { upgrade, open: openClock, openDate: openCalendar, close: () => closePop(false) };
})();
