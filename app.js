/* Believing Me — daily tracker for Picoq launch, sleep rhythm and movement.
   All data stays on the device (localStorage). No build step, no dependencies. */
(() => {
  'use strict';

  const KEY = 'believing-me.v1';
  const $ = (s, el = document) => el.querySelector(s);
  const $$ = (s, el = document) => [...el.querySelectorAll(s)];
  const SVGNS = 'http://www.w3.org/2000/svg';

  // ---------- dates & times ----------
  const pad2 = (n) => String(n).padStart(2, '0');
  const keyOf = (d) => `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;
  const parseKey = (k) => { const [y, m, d] = k.split('-').map(Number); return new Date(y, m - 1, d); };
  const addDays = (k, n) => { const d = parseKey(k); d.setDate(d.getDate() + n); return keyOf(d); };
  const daysBetween = (a, b) => Math.round((parseKey(b) - parseKey(a)) / 864e5);
  const todayKey = () => keyOf(new Date());
  const toMin = (t) => { if (!t) return null; const [h, m] = t.split(':').map(Number); return h * 60 + m; };
  const fromMin = (m) => { m = ((Math.round(m) % 1440) + 1440) % 1440; return `${pad2(Math.floor(m / 60))}:${pad2(m % 60)}`; };
  // signed minutes from target, wrapped to [-720, 720)
  const devMin = (t, target) => (((toMin(t) - toMin(target)) % 1440) + 1440 + 720) % 1440 - 720;
  const fmtDev = (d) => d === 0 ? 'on the dot' : `${Math.abs(d)} min ${d > 0 ? 'late' : 'early'}`;
  const fmtShort = (k) => parseKey(k).toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
  const fmtLong = (k) => parseKey(k).toLocaleDateString(undefined, { weekday: 'long', month: 'long', day: 'numeric' });
  const uid = () => Math.random().toString(36).slice(2, 10);
  const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

  // ---------- state ----------
  function defaults() {
    const t = todayKey();
    return {
      settings: { name: '', startDate: t, launchDate: addDays(t, 90), sleepTarget: '22:30', wakeTarget: '06:30', tolerance: 30, moveTarget: 60 },
      milestones: [
        'Lock the MVP scope', 'Core features working', 'Landing page live', 'First 10 beta users',
        'Pricing & payments', 'Launch announcement ready', 'Picoq is LIVE 🚀',
      ].map((title) => ({ id: uid(), title, done: false, doneDate: null })),
      days: {},
    };
  }
  function load() {
    try {
      const raw = localStorage.getItem(KEY);
      if (raw) {
        const s = JSON.parse(raw);
        const d = defaults();
        return { settings: { ...d.settings, ...s.settings }, milestones: s.milestones || [], days: s.days || {} };
      }
    } catch (e) { /* storage unavailable or corrupt */ }
    return defaults();
  }
  let state = load();
  function save() {
    try { localStorage.setItem(KEY, JSON.stringify(state)); } catch (e) { toast('Could not save — storage is full or blocked'); }
  }
  const day = (k) => (state.days[k] ||= { notes: [], bed: '', wake: '', move: 0, moveType: '', prs: [] });
  const peek = (k) => state.days[k];

  // ---------- scoring ----------
  const S = () => state.settings;
  const onTime = (t, target) => t && Math.abs(devMin(t, target)) <= Number(S().tolerance);
  function scores(k) {
    const d = peek(k);
    if (!d) return { picoq: 0, sleep: 0, move: 0, total: 0, hits: 0 };
    const picoq = d.notes.length ? 1 : 0;
    const sleep = (onTime(d.bed, S().sleepTarget) ? 0.5 : 0) + (onTime(d.wake, S().wakeTarget) ? 0.5 : 0);
    const move = Math.min((Number(d.move) || 0) / Number(S().moveTarget), 1);
    const hits = (picoq >= 1) + (sleep >= 1) + (move >= 1);
    return { picoq, sleep, move, total: Math.round(((picoq + sleep + move) / 3) * 100), hits };
  }
  const isWin = (k) => scores(k).hits >= 2;

  function streak(test = isWin) {
    let k = todayKey();
    if (!test(k)) k = addDays(k, -1); // today still in progress
    let n = 0;
    while (test(k) && n < 3650) { n++; k = addDays(k, -1); }
    return n;
  }
  function bestStreak(test = isWin) {
    const keys = Object.keys(state.days).sort();
    if (!keys.length) return 0;
    let best = 0, cur = 0, k = keys[0];
    const end = todayKey();
    while (k <= end) { cur = test(k) ? cur + 1 : 0; best = Math.max(best, cur); k = addDays(k, 1); }
    return best;
  }
  function xp() {
    let total = 0;
    for (const k of Object.keys(state.days)) {
      const s = scores(k);
      total += s.total + (s.hits === 3 ? 50 : 0);
      total += (state.days[k].prs || []).length * 15;
    }
    total += state.milestones.filter((m) => m.done).length * 150;
    return total;
  }
  const lvlReq = (n) => 150 * (n - 1) * (n - 1);

  // PR detection: walk entries chronologically, flag entries that beat the previous best.
  function prIndex() {
    const all = [];
    for (const k of Object.keys(state.days).sort()) {
      for (const p of state.days[k].prs || []) all.push({ ...p, date: k });
    }
    const best = {};
    const flagged = {};
    for (const p of all) {
      const ex = p.ex.trim().toLowerCase() + '|' + p.unit;
      const b = best[ex];
      const better = b == null || (p.lower ? p.val < b : p.val > b);
      flagged[p.id] = b == null ? 'first' : better ? 'pr' : '';
      if (better) best[ex] = p.val;
    }
    return { all, flagged };
  }

  // ---------- UI state ----------
  let current = todayKey();
  let tab = 'today';

  // ---------- rings ----------
  function ringsSVG(sc) {
    const rings = [
      { v: sc.picoq, c: 'var(--picoq)', r: 56, label: 'Picoq' },
      { v: sc.sleep, c: 'var(--sleep)', r: 42, label: 'Sleep' },
      { v: sc.move, c: 'var(--move)', r: 28, label: 'Move' },
    ];
    const sw = 11;
    let out = `<svg viewBox="0 0 132 132" role="img" aria-label="Picoq ${Math.round(sc.picoq * 100)}%, Sleep ${Math.round(sc.sleep * 100)}%, Move ${Math.round(sc.move * 100)}%">`;
    for (const r of rings) {
      const C = 2 * Math.PI * r.r;
      const off = C * (1 - Math.max(0.001, r.v));
      out += `<circle class="ring-track" cx="66" cy="66" r="${r.r}" fill="none" stroke="${r.c}" stroke-width="${sw}"/>`;
      out += `<circle class="ring-arc" cx="66" cy="66" r="${r.r}" fill="none" stroke="${r.c}" stroke-width="${sw}" stroke-linecap="round"
        stroke-dasharray="${C}" stroke-dashoffset="${r.v > 0 ? off : C}" transform="rotate(-90 66 66)"><title>${r.label}: ${Math.round(r.v * 100)}%</title></circle>`;
    }
    return out + '</svg>';
  }

  const MSGS = [
    [0, ['Every launch starts with one small move.', 'Fresh day. Pick one thing and start.', 'You showed up — that already counts.']],
    [34, ['Momentum is building. Keep going.', 'Good start — one more ring to close?', 'Nice. Stack another win.']],
    [67, ['Two of three — you are close!', 'Strong day. Finish it off.', 'This is what consistency looks like.']],
    [100, ['All three rings closed. You kept your word to yourself. 🎉', 'Perfect day. Picoq is closer because of you.', 'Full marks. Believe it.']],
  ];
  function message(score) {
    let pool = MSGS[0][1];
    for (const [min, p] of MSGS) if (score >= min) pool = p;
    const seed = [...current].reduce((a, c) => a + c.charCodeAt(0), 0);
    return pool[seed % pool.length];
  }

  // ---------- render: header ----------
  function renderHeader() {
    const h = new Date().getHours();
    const part = h < 5 ? 'Up late' : h < 12 ? 'Good morning' : h < 17 ? 'Good afternoon' : 'Good evening';
    $('#greeting').textContent = S().name ? `${part}, ${S().name}` : part;
    $('#today-label').textContent = fmtLong(todayKey());
    const x = xp();
    let n = 1;
    while (x >= lvlReq(n + 1) && n < 999) n++;
    const lo = lvlReq(n), hi = lvlReq(n + 1);
    $('#level-num').textContent = `Lv ${n} · ${x.toLocaleString()} XP`;
    $('#level-fill').style.width = `${Math.min(100, ((x - lo) / (hi - lo)) * 100)}%`;
  }

  // ---------- render: today ----------
  function renderToday() {
    const k = current;
    const d = peek(k) || { notes: [], bed: '', wake: '', move: 0, moveType: '', prs: [] };
    const sc = scores(k);
    const t = todayKey();

    $('#today-rings').innerHTML = ringsSVG(sc);
    $('#today-score').textContent = sc.total;
    $('#today-msg').textContent = message(sc.total);
    const st = streak();
    $('#streak-num').textContent = st;
    $('#streak-chip').classList.toggle('hot', st >= 3);

    $('#date-pill').textContent = k === t ? 'Today' : k === addDays(t, -1) ? 'Yesterday' : fmtShort(k);
    $('#next-day').disabled = k >= t;

    // Picoq
    const left = daysBetween(t, S().launchDate);
    $('#launch-countdown').textContent = left > 0 ? `${left} days to launch · ${fmtShort(S().launchDate)}`
      : left === 0 ? 'Launch day is TODAY. Go! 🚀' : `Launch date passed ${-left} days ago — update it in Goals`;
    setBadge('#picoq-badge', d.notes.length ? `✓ ${d.notes.length} logged` : 'Not yet', d.notes.length > 0);
    $('#picoq-list').innerHTML = d.notes.map((n) => `<li><span class="t">${esc(n.text)}</span>
      <span class="meta">${new Date(n.ts).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</span>
      <button class="x" data-del-note="${n.id}" aria-label="Delete">×</button></li>`).join('');

    const ms = state.milestones;
    $('#ms-count').textContent = `(${ms.filter((m) => m.done).length}/${ms.length})`;
    $('#ms-list').innerHTML = ms.map((m) => `<li class="${m.done ? 'done' : ''}">
      <label><input type="checkbox" data-ms="${m.id}" ${m.done ? 'checked' : ''}/><span>${esc(m.title)}</span></label>
      ${m.done ? `<span class="meta hint">${fmtShort(m.doneDate)}</span>` : ''}
      <button class="x" data-del-ms="${m.id}" aria-label="Remove">×</button></li>`).join('');

    // Sleep
    $('#sleep-target-label').textContent = `Target: bed by ${S().sleepTarget}, up at ${S().wakeTarget} (±${S().tolerance} min)`;
    $('#bed-input').value = d.bed || '';
    $('#wake-input').value = d.wake || '';
    const parts = [];
    if (d.bed) parts.push(onTime(d.bed, S().sleepTarget) ? '🌙✓' : '🌙✗');
    if (d.wake) parts.push(onTime(d.wake, S().wakeTarget) ? '☀️✓' : '☀️✗');
    setBadge('#sleep-badge', parts.length ? parts.join(' ') : 'Not yet', sc.sleep >= 1);

    // Move
    if (document.activeElement !== $('#move-input')) $('#move-input').value = d.move || '';
    $('#move-bar').style.width = `${sc.move * 100}%`;
    setBadge('#move-badge', d.move ? `${d.move}/${S().moveTarget} min` : 'Not yet', sc.move >= 1);
    $$('#move-type button').forEach((b) => b.classList.toggle('on', b.dataset.t === d.moveType));

    const { flagged } = prIndex();
    $('#pr-list').innerHTML = (d.prs || []).map((p) => `<li><span class="t">${esc(p.ex)} — <b>${p.val} ${esc(p.unit)}</b></span>
      ${flagged[p.id] === 'pr' ? '<span class="pr-tag">NEW PR</span>' : flagged[p.id] === 'first' ? '<span class="meta">first log</span>' : ''}
      <button class="x" data-del-pr="${p.id}" aria-label="Delete">×</button></li>`).join('');
    const exs = [...new Set(prIndex().all.map((p) => p.ex.trim()))];
    $('#pr-ex-list').innerHTML = exs.map((e) => `<option value="${esc(e)}">`).join('');
  }
  function setBadge(sel, text, done) {
    const el = $(sel);
    el.textContent = text;
    el.classList.toggle('done', !!done);
  }

  // ---------- charts ----------
  const tip = $('#tooltip');
  function showTip(x, y, html) { tip.innerHTML = html; tip.hidden = false; tip.style.left = `${x}px`; tip.style.top = `${y}px`; }
  function hideTip() { tip.hidden = true; }

  function frame(el, h = 190, padL = 40) {
    const w = Math.max(280, el.clientWidth || 320);
    const pad = { l: padL, r: 12, t: 12, b: 26 };
    return { w, h, pad, iw: w - pad.l - pad.r, ih: h - pad.t - pad.b };
  }
  function svgOpen(f, label) {
    return `<svg viewBox="0 0 ${f.w} ${f.h}" width="${f.w}" height="${f.h}" role="img" aria-label="${esc(label)}">`;
  }
  function yTicks(f, y, ticks, fmt) {
    return ticks.map((v) => `<line class="grid-line" x1="${f.pad.l}" x2="${f.w - f.pad.r}" y1="${y(v)}" y2="${y(v)}"/>
      <text class="tick" x="${f.pad.l - 6}" y="${y(v) + 3.5}" text-anchor="end">${fmt(v)}</text>`).join('');
  }
  function xLabels(f, keys, x, every) {
    return keys.map((k, i) => (i % every === 0 || i === keys.length - 1) && !(i !== keys.length - 1 && keys.length - 1 - i < every * 0.6)
      ? `<text class="tick" x="${x(i)}" y="${f.h - 8}" text-anchor="middle">${fmtShort(k)}</text>` : '').join('');
  }
  // hover layer: nearest index by x; tips[i] is HTML or null
  function hover(el, f, n, x, tips, pointY) {
    const svg = $('svg', el);
    if (!svg) return;
    const cross = document.createElementNS(SVGNS, 'line');
    cross.setAttribute('class', 'crosshair');
    cross.setAttribute('y1', f.pad.t); cross.setAttribute('y2', f.h - f.pad.b);
    cross.style.display = 'none';
    svg.appendChild(cross);
    const move = (ev) => {
      const r = svg.getBoundingClientRect();
      const px = ((ev.clientX - r.left) / r.width) * f.w;
      let best = -1, bd = Infinity;
      for (let i = 0; i < n; i++) { if (tips[i] == null) continue; const dd = Math.abs(x(i) - px); if (dd < bd) { bd = dd; best = i; } }
      if (best < 0) return leave();
      cross.setAttribute('x1', x(best)); cross.setAttribute('x2', x(best)); cross.style.display = '';
      const sy = pointY ? pointY(best) : f.pad.t + 10;
      showTip(r.left + (x(best) / f.w) * r.width, r.top + (sy / f.h) * r.height, tips[best]);
    };
    const leave = () => { cross.style.display = 'none'; hideTip(); };
    svg.addEventListener('pointermove', move);
    svg.addEventListener('pointerdown', move);
    svg.addEventListener('pointerleave', leave);
  }
  const lastN = (n) => Array.from({ length: n }, (_, i) => addDays(todayKey(), i - n + 1));

  function chartScore() {
    const el = $('#chart-score');
    const keys = lastN(30);
    const f = frame(el, 200, 32);
    const vals = keys.map((k) => (peek(k) ? scores(k).total : null));
    const mom = keys.map((k, i) => {
      const win = keys.slice(Math.max(0, i - 6), i + 1).map((kk) => (peek(kk) ? scores(kk).total : 0));
      return Math.round(win.reduce((a, b) => a + b, 0) / win.length);
    });
    const x = (i) => f.pad.l + (i + 0.5) * (f.iw / keys.length);
    const y = (v) => f.pad.t + f.ih - (v / 100) * f.ih;
    const bw = Math.max(3, f.iw / keys.length - 2);
    let s = svgOpen(f, 'Daily score, last 30 days') + yTicks(f, y, [0, 50, 100], (v) => v);
    keys.forEach((k, i) => {
      const v = vals[i];
      if (!v) return;
      const top = y(v), bot = y(0);
      const r = Math.min(4, bw / 2);
      s += `<path d="M${x(i) - bw / 2},${bot} V${top + r} q0,-${r} ${r},-${r} h${bw - 2 * r} q${r},0 ${r},${r} V${bot} Z" fill="var(--ink-2)" opacity=".38"/>`;
    });
    s += `<path d="${mom.map((v, i) => `${i ? 'L' : 'M'}${x(i)},${y(v)}`).join('')}" fill="none" stroke="var(--ink)" stroke-width="2" stroke-linejoin="round" stroke-linecap="round"/>`;
    const li = keys.length - 1;
    s += `<circle cx="${x(li)}" cy="${y(mom[li])}" r="4" fill="var(--ink)" stroke="var(--surface)" stroke-width="2"/>`;
    s += `<text class="dlabel" x="${x(li) - 8}" y="${y(mom[li]) - 9}" text-anchor="end">momentum ${mom[li]}</text>`;
    s += `<line class="axis-line" x1="${f.pad.l}" x2="${f.w - f.pad.r}" y1="${y(0)}" y2="${y(0)}"/>`;
    s += xLabels(f, keys, x, 7) + '</svg>';
    el.innerHTML = s;
    hover(el, f, keys.length, x, keys.map((k, i) => `${fmtShort(k)} · score ${vals[i] ?? 0} · momentum ${mom[i]}`), (i) => y(Math.max(vals[i] || 0, mom[i])));
  }

  function chartHeat() {
    const el = $('#chart-heat');
    const weeks = 16, cell = 15, gap = 3;
    const t = todayKey();
    const dow = (parseKey(t).getDay() + 6) % 7; // Monday = 0
    const start = addDays(t, -(weeks - 1) * 7 - dow);
    const w = 22 + weeks * (cell + gap), h = 7 * (cell + gap) + 16;
    let s = `<svg viewBox="0 0 ${w} ${h}" width="${w}" height="${h}" role="img" aria-label="Consistency heatmap">`;
    ['M', '', 'W', '', 'F', '', 'S'].forEach((l, i) => { if (l) s += `<text class="tick" x="0" y="${16 + i * (cell + gap) + 11}">${l}</text>`; });
    let lastMonth = -1;
    for (let wk = 0; wk < weeks; wk++) {
      for (let d = 0; d < 7; d++) {
        const k = addDays(start, wk * 7 + d);
        if (k > t) continue;
        const sc = scores(k);
        const m = parseKey(k).getMonth();
        if (d === 0 && m !== lastMonth) {
          s += `<text class="tick" x="${22 + wk * (cell + gap)}" y="10">${parseKey(k).toLocaleDateString(undefined, { month: 'short' })}</text>`;
          lastMonth = m;
        }
        const lvl = peek(k) ? (sc.total > 0 ? Math.max(1, sc.hits) : 0) : 0;
        s += `<rect x="${22 + wk * (cell + gap)}" y="${16 + d * (cell + gap)}" width="${cell}" height="${cell}" rx="3"
          fill="var(--heat-${lvl})" ${k === t ? 'stroke="var(--ink)" stroke-width="1.5"' : ''} data-tip="${fmtShort(k)} · ${sc.hits}/3 goals · score ${sc.total}"/>`;
      }
    }
    s += '</svg>';
    el.innerHTML = s + `<div class="heat-legend">Less <i style="background:var(--heat-0)"></i><i style="background:var(--heat-1)"></i><i style="background:var(--heat-2)"></i><i style="background:var(--heat-3)"></i> All 3</div>`;
    $$('rect[data-tip]', el).forEach((r) => {
      const on = () => { const b = r.getBoundingClientRect(); showTip(b.left + b.width / 2, b.top, r.dataset.tip); };
      r.addEventListener('pointerenter', on); r.addEventListener('pointerdown', on); r.addEventListener('pointerleave', hideTip);
    });
  }

  function chartLaunch() {
    const el = $('#chart-launch');
    const { startDate, launchDate } = S();
    const ms = state.milestones;
    const total = daysBetween(startDate, launchDate);
    if (!ms.length || total <= 0) {
      el.innerHTML = `<p class="empty">Add milestones and a launch date after your start date to see your pace.</p>`;
      $('#pace-sub').textContent = '';
      return;
    }
    const t = todayKey();
    const f = frame(el, 200, 40);
    const x = (i) => f.pad.l + (i / total) * f.iw;
    const y = (v) => f.pad.t + f.ih - (v / 100) * f.ih;
    const pctAt = (k) => (ms.filter((m) => m.done && m.doneDate && m.doneDate <= k).length / ms.length) * 100;
    const elapsed = Math.max(0, Math.min(total, daysBetween(startDate, t)));
    const keys = Array.from({ length: total + 1 }, (_, i) => addDays(startDate, i));
    const actual = keys.slice(0, elapsed + 1).map(pctAt);
    const ideal = (i) => (i / total) * 100;
    const now = actual[actual.length - 1] ?? 0;
    const diff = Math.round(now - ideal(elapsed));
    $('#pace-sub').innerHTML = `${ms.filter((m) => m.done).length} of ${ms.length} milestones done · ` +
      (diff >= 0 ? `<b style="color:var(--good)">▲ ${diff} pts ahead of pace</b>` : `<b style="color:var(--sleep)">▼ ${-diff} pts behind pace</b>`);

    let s = svgOpen(f, 'Launch progress vs ideal pace') + yTicks(f, y, [0, 50, 100], (v) => `${v}%`);
    s += `<line class="target" x1="${x(0)}" y1="${y(0)}" x2="${x(total)}" y2="${y(100)}"/>`;
    s += `<text class="dlabel" x="${x(total) - 4}" y="${y(100) + 14}" text-anchor="end">ideal pace</text>`;
    // step line for actual progress
    let d = `M${x(0)},${y(actual[0] || 0)}`;
    for (let i = 1; i < actual.length; i++) d += ` H${x(i)} V${y(actual[i])}`;
    s += `<path d="${d} V${y(0)} H${x(0)} Z" fill="var(--picoq)" opacity=".14"/>`;
    s += `<path d="${d}" fill="none" stroke="var(--picoq)" stroke-width="2" stroke-linejoin="round"/>`;
    // work-day ticks: days with Picoq notes
    keys.slice(0, elapsed + 1).forEach((k, i) => { if (peek(k)?.notes.length) s += `<line x1="${x(i)}" x2="${x(i)}" y1="${y(0)}" y2="${y(0) - 5}" stroke="var(--picoq)" stroke-width="2" stroke-linecap="round"/>`; });
    s += `<circle cx="${x(elapsed)}" cy="${y(now)}" r="5" fill="var(--picoq)" stroke="var(--surface)" stroke-width="2"/>`;
    s += `<text class="dlabel" x="${x(elapsed) + (elapsed > total * 0.7 ? -9 : 9)}" y="${y(now) - 8}" text-anchor="${elapsed > total * 0.7 ? 'end' : 'start'}">you · ${Math.round(now)}%</text>`;
    s += `<line class="axis-line" x1="${f.pad.l}" x2="${f.w - f.pad.r}" y1="${y(0)}" y2="${y(0)}"/>`;
    s += `<text class="tick" x="${x(0)}" y="${f.h - 8}" text-anchor="start">${fmtShort(startDate)}</text>`;
    s += `<text class="tick" x="${x(total)}" y="${f.h - 8}" text-anchor="end">🚀 ${fmtShort(launchDate)}</text></svg>`;
    el.innerHTML = s;
    const tips = keys.map((k, i) => i <= elapsed
      ? `${fmtShort(k)} · ${Math.round(actual[i])}% done · pace ${Math.round(ideal(i))}%${peek(k)?.notes.length ? ` · ${peek(k).notes.length} logged` : ''}`
      : null);
    hover(el, f, keys.length, x, tips, (i) => y(Math.max(actual[i] || 0, ideal(i))));
  }

  function chartTime(elSel, subSel, field, target, label) {
    const el = $(elSel);
    const keys = lastN(30);
    const tol = Number(S().tolerance);
    const devs = keys.map((k) => (peek(k)?.[field] ? devMin(peek(k)[field], target) : null));
    const logged = devs.filter((v) => v != null);
    const recent = keys.slice(-14).map((k, i) => devs[16 + i]).filter((v) => v != null);
    const hit = recent.filter((v) => Math.abs(v) <= tol).length;
    $(subSel).textContent = recent.length
      ? `${hit} of last ${recent.length} logged days within ±${tol} min · avg ${fmtDev(Math.round(recent.reduce((a, b) => a + b, 0) / recent.length))}`
      : `Log your ${label} times to see how steady your rhythm is.`;
    const span = Math.max(90, tol * 2, ...logged.map((v) => Math.ceil(Math.abs(v) / 30) * 30));
    const f = frame(el, 180, 44);
    const x = (i) => f.pad.l + (i + 0.5) * (f.iw / keys.length);
    const y = (v) => f.pad.t + f.ih / 2 + (v / span) * (f.ih / 2); // later = lower on screen
    const tm = toMin(target);
    const ticks = [-span, -span / 2, 0, span / 2, span];
    let s = svgOpen(f, `${label} time vs target`) + yTicks(f, y, ticks, (v) => fromMin(tm + v));
    s += `<rect class="band" x="${f.pad.l}" width="${f.iw}" y="${y(-tol)}" height="${y(tol) - y(-tol)}"/>`;
    s += `<line class="target" x1="${f.pad.l}" x2="${f.w - f.pad.r}" y1="${y(0)}" y2="${y(0)}"/>`;
    let path = '', pen = false;
    devs.forEach((v, i) => { if (v == null) { pen = false; return; } path += `${pen ? 'L' : 'M'}${x(i)},${y(v)}`; pen = true; });
    s += `<path d="${path}" fill="none" stroke="var(--sleep)" stroke-width="2" stroke-linejoin="round" stroke-linecap="round"/>`;
    devs.forEach((v, i) => {
      if (v == null) return;
      const ok = Math.abs(v) <= tol;
      s += `<circle cx="${x(i)}" cy="${y(v)}" r="${ok ? 4.5 : 4}" fill="${ok ? 'var(--sleep)' : 'var(--surface)'}" stroke="var(--sleep)" stroke-width="2"/>`;
    });
    s += xLabels(f, keys, x, 7) + '</svg>';
    el.innerHTML = s;
    hover(el, f, keys.length, x, keys.map((k, i) => devs[i] == null ? null
      : `${fmtShort(k)} · ${peek(k)[field]} · ${fmtDev(devs[i])} ${Math.abs(devs[i]) <= tol ? '✓' : '✗'}`), (i) => y(devs[i] ?? 0));
  }

  function chartMove() {
    const el = $('#chart-move');
    const keys = lastN(30);
    const target = Number(S().moveTarget);
    const vals = keys.map((k) => Number(peek(k)?.move) || 0);
    const hitDays = vals.slice(-7).filter((v) => v >= target).length;
    const week = vals.slice(-7).reduce((a, b) => a + b, 0);
    $('#move-sub').textContent = `This week: ${hitDays}/7 days hit ${target} min · ${Math.round(week / 60 * 10) / 10} h total`;
    const max = Math.max(target * 1.5, ...vals);
    const f = frame(el, 180, 36);
    const x = (i) => f.pad.l + (i + 0.5) * (f.iw / keys.length);
    const y = (v) => f.pad.t + f.ih - (v / max) * f.ih;
    const bw = Math.max(3, f.iw / keys.length - 2);
    const step = max > 150 ? 60 : 30;
    const ticks = []; for (let v = 0; v <= max; v += step) ticks.push(v);
    let s = svgOpen(f, 'Movement minutes, last 30 days') + yTicks(f, y, ticks, (v) => v);
    vals.forEach((v, i) => {
      if (!v) return;
      const r = Math.min(4, bw / 2), top = y(v), bot = y(0);
      s += `<path d="M${x(i) - bw / 2},${bot} V${top + r} q0,-${r} ${r},-${r} h${bw - 2 * r} q${r},0 ${r},${r} V${bot} Z" fill="var(--move)" opacity="${v >= target ? 1 : 0.45}"/>`;
    });
    s += `<line class="target" x1="${f.pad.l}" x2="${f.w - f.pad.r}" y1="${y(target)}" y2="${y(target)}"/>`;
    s += `<text class="dlabel" x="${f.w - f.pad.r}" y="${y(target) - 5}" text-anchor="end">goal ${target} min</text>`;
    s += `<line class="axis-line" x1="${f.pad.l}" x2="${f.w - f.pad.r}" y1="${y(0)}" y2="${y(0)}"/>`;
    s += xLabels(f, keys, x, 7) + '</svg>';
    el.innerHTML = s;
    hover(el, f, keys.length, x, keys.map((k, i) => `${fmtShort(k)} · ${vals[i]} min${peek(k)?.moveType ? ' · ' + esc(peek(k).moveType) : ''}`), (i) => y(vals[i]));
  }

  function chartPR() {
    const el = $('#chart-pr');
    const sel = $('#pr-select');
    const { all, flagged } = prIndex();
    const groups = {};
    for (const p of all) (groups[p.ex.trim().toLowerCase() + '|' + p.unit] ||= []).push(p);
    const ids = Object.keys(groups);
    if (!ids.length) { sel.hidden = true; el.innerHTML = '<p class="empty">Log a lift, run or rep count on the Today tab to start tracking PRs.</p>'; return; }
    sel.hidden = false;
    const prev = sel.value;
    sel.innerHTML = ids.map((id) => `<option value="${esc(id)}">${esc(groups[id][0].ex.trim())} (${esc(groups[id][0].unit)})</option>`).join('');
    sel.value = ids.includes(prev) ? prev : ids[ids.length - 1];
    const pts = groups[sel.value];
    const lower = pts.some((p) => p.lower);
    const vs = pts.map((p) => p.val);
    let lo = Math.min(...vs), hi = Math.max(...vs);
    const padv = (hi - lo) * 0.2 || Math.max(1, hi * 0.1);
    lo = Math.max(0, lo - padv); hi = hi + padv;
    const f = frame(el, 180, 40);
    const n = pts.length;
    const x = (i) => f.pad.l + (n === 1 ? f.iw / 2 : (i / (n - 1)) * f.iw);
    const y = (v) => lower ? f.pad.t + ((v - lo) / (hi - lo)) * f.ih : f.pad.t + f.ih - ((v - lo) / (hi - lo)) * f.ih;
    const nice = (v) => Math.round(v * 10) / 10;
    let s = svgOpen(f, 'PR progression') + yTicks(f, y, [lo, (lo + hi) / 2, hi], nice);
    s += `<path d="${pts.map((p, i) => `${i ? 'L' : 'M'}${x(i)},${y(p.val)}`).join('')}" fill="none" stroke="var(--move)" stroke-width="2" stroke-linejoin="round"/>`;
    pts.forEach((p, i) => {
      const pr = flagged[p.id] === 'pr' || flagged[p.id] === 'first';
      s += `<circle cx="${x(i)}" cy="${y(p.val)}" r="${pr ? 5.5 : 4}" fill="${pr ? 'var(--warn)' : 'var(--move)'}" stroke="var(--surface)" stroke-width="2"/>`;
    });
    const bestP = pts.reduce((b, p) => (lower ? p.val < b.val : p.val > b.val) ? p : b);
    const bi = pts.indexOf(bestP);
    s += `<text class="dlabel" x="${x(bi)}" y="${y(bestP.val) - 10}" text-anchor="${bi === n - 1 && n > 1 ? 'end' : 'middle'}">best ${bestP.val} ${esc(bestP.unit)}</text>`;
    s += `<text class="tick" x="${x(0)}" y="${f.h - 8}" text-anchor="${n === 1 ? 'middle' : 'start'}">${fmtShort(pts[0].date)}</text>`;
    if (n > 1) s += `<text class="tick" x="${x(n - 1)}" y="${f.h - 8}" text-anchor="end">${fmtShort(pts[n - 1].date)}</text>`;
    s += '</svg>';
    el.innerHTML = s + `<p class="hint">★ Gold dots are personal records${lower ? ' (lower is better — chart is flipped so up = faster)' : ''}.</p>`;
    hover(el, f, n, x, pts.map((p) => `${fmtShort(p.date)} · ${p.val} ${esc(p.unit)}${flagged[p.id] === 'pr' ? ' · NEW PR ★' : ''}`), (i) => y(pts[i].val));
  }

  const PILLARS = [
    { id: 'picoq', name: 'Picoq', c: 'var(--picoq)', hit: (k) => (peek(k)?.notes.length || 0) > 0 },
    { id: 'sleep', name: 'Sleep', c: 'var(--sleep)', hit: (k) => scores(k).sleep >= 1 },
    { id: 'move', name: 'Move', c: 'var(--move)', hit: (k) => scores(k).move >= 1 },
  ];

  // One map: start at (0,0), goal at top-right. Dashed diagonal = on track.
  // Picoq climbs with milestones done; Sleep and Move climb one step per day the goal is hit.
  function chartJourney() {
    const el = $('#chart-journey');
    const { startDate, launchDate } = S();
    const N = daysBetween(startDate, launchDate);
    if (N <= 0) { el.innerHTML = '<p class="empty">Set a launch date after your start date in Goals.</p>'; return; }
    const t = todayKey();
    const done = Math.max(0, Math.min(N, daysBetween(startDate, t))); // full days before today
    const ms = state.milestones;
    const msPct = (k) => ms.length ? (ms.filter((m) => m.done && m.doneDate && m.doneDate <= k).length / ms.length) * 100 : 0;
    const series = PILLARS.map((p) => {
      const ys = [0];
      let hits = 0;
      for (let j = 1; j <= done; j++) {
        const k = addDays(startDate, j - 1);
        if (p.id === 'picoq') ys.push(msPct(k));
        else { if (p.hit(k)) hits++; ys.push((hits / N) * 100); }
      }
      // today counts only once it's achieved, so the line never dips mid-day
      const last = p.id === 'picoq' ? msPct(t) : ((hits + (done < N && p.hit(t) ? 1 : 0)) / N) * 100;
      ys[ys.length - 1] = Math.max(ys[ys.length - 1], last);
      return { ...p, ys };
    });
    const ideal = (j) => (j / N) * 100;

    const w = Math.max(280, el.clientWidth || 320);
    const f = { w, h: Math.round(Math.min(340, w * 0.85)), pad: { l: 14, r: 64, t: 30, b: 28 } };
    f.iw = f.w - f.pad.l - f.pad.r; f.ih = f.h - f.pad.t - f.pad.b;
    const x = (j) => f.pad.l + (j / N) * f.iw;
    const y = (v) => f.pad.t + f.ih - (Math.min(100, v) / 100) * f.ih;

    let s = svgOpen(f, 'Progress towards the three goals');
    s += `<line class="grid-line" x1="${x(0)}" x2="${x(N)}" y1="${y(100)}" y2="${y(100)}"/>`;
    s += `<line class="grid-line" x1="${x(N)}" x2="${x(N)}" y1="${y(0)}" y2="${y(100)}"/>`;
    s += `<line class="axis-line" x1="${x(0)}" x2="${x(N)}" y1="${y(0)}" y2="${y(0)}"/>`;
    s += `<line class="axis-line" x1="${x(0)}" x2="${x(0)}" y1="${y(0)}" y2="${y(100)}"/>`;
    s += `<line class="target" x1="${x(0)}" y1="${y(0)}" x2="${x(N)}" y2="${y(100)}"/>`;
    s += `<circle cx="${x(N)}" cy="${y(100)}" r="7" fill="var(--surface)" stroke="var(--ink)" stroke-width="2"/>`;
    s += `<text class="j-goal" x="${x(N) + 2}" y="${y(100) - 12}" text-anchor="middle">🏁</text>`;
    s += `<text class="dlabel" x="${x(N) + 12}" y="${y(100) + 4}">Goal</text>`;
    s += `<text class="dlabel" x="${x(0)}" y="${f.h - 8}">Start</text>`;
    s += `<text class="dlabel" x="${x(N)}" y="${f.h - 8}" text-anchor="middle">Launch</text>`;
    if (done > 0 && done < N) s += `<line class="crosshair" x1="${x(done)}" x2="${x(done)}" y1="${y(0)}" y2="${y(0) + 5}"/><text class="tick" x="${x(done)}" y="${f.h - 8}" text-anchor="middle">today</text>`;

    for (const sr of series) {
      s += `<path class="j-line" stroke="${sr.c}" d="${sr.ys.map((v, j) => `${j ? 'L' : 'M'}${x(j)},${y(v)}`).join('')}"/>`;
    }
    // end dots + direct labels, nudged apart so they never overlap
    const ends = series.map((sr) => ({ sr, j: sr.ys.length - 1, v: sr.ys[sr.ys.length - 1] }))
      .map((e) => ({ ...e, ly: y(e.v) })).sort((a, b) => a.ly - b.ly);
    for (let i = 1; i < ends.length; i++) ends[i].ly = Math.max(ends[i].ly, ends[i - 1].ly + 14);
    for (const e of ends) {
      s += `<circle cx="${x(e.j)}" cy="${y(e.v)}" r="5" fill="${e.sr.c}" stroke="var(--surface)" stroke-width="2"/>`;
      s += `<text class="dlabel" x="${x(e.j) + 9}" y="${e.ly + 4}">${e.sr.name}</text>`;
    }
    el.innerHTML = s + '</svg>';

    const verdict = series.map((sr) => {
      const j = sr.ys.length - 1, gap = sr.ys[j] - ideal(j);
      const ok = gap >= -0.5;
      return `<span style="white-space:nowrap"><span class="dot" style="background:${sr.c}"></span> ${sr.name} <b style="color:${ok ? 'var(--good)' : 'var(--bad)'}">${ok ? '▲ on track' : '▼ behind'}</b></span>`;
    });
    $('#journey-sub').innerHTML = verdict.join(' &nbsp; ');

    const tips = Array.from({ length: N + 1 }, (_, j) => j <= done
      ? `${j === 0 ? 'Start' : fmtShort(addDays(startDate, j - 1))} · ${series.map((sr) => `${sr.name} ${Math.round(sr.ys[j] ?? 0)}%`).join(' · ')} · pace ${Math.round(ideal(j))}%`
      : null);
    hover(el, f, N + 1, x, tips, (j) => y(Math.max(...series.map((sr) => sr.ys[j] ?? 0))));
  }

  function renderWeek() {
    const keys = lastN(7), t = todayKey();
    let h = '<div class="week"><span></span>';
    for (const k of keys) {
      const d = parseKey(k);
      h += `<span class="wh ${k === t ? 'today' : ''}">${d.toLocaleDateString(undefined, { weekday: 'short' })}<br>${d.getDate()}</span>`;
    }
    for (const p of PILLARS) {
      h += `<span class="wl" data-pillar="${p.id}"><span class="dot"></span>${p.name}</span>`;
      for (const k of keys) {
        const hit = p.hit(k);
        const cls = hit ? 'hit' : (k === t || k < S().startDate) ? 'wait' : 'miss';
        const label = hit ? 'done' : cls === 'wait' ? (k === t ? 'not yet' : 'before start') : 'missed';
        h += `<span class="box ${cls}" title="${p.name} ${fmtShort(k)}: ${label}" aria-label="${p.name} ${fmtShort(k)}: ${label}">${hit ? '✓' : cls === 'miss' ? '✕' : ''}</span>`;
      }
    }
    h += '</div><div class="week-legend"><span><i style="background:var(--good)"></i>Done</span><span><i style="background:var(--bad)"></i>Missed</span><span><i style="border:1.5px dashed var(--axis)"></i>Today, not yet</span></div>';
    $('#week-grid').innerHTML = h;
  }

  function renderKPIs() {
    const t = todayKey();
    const st = streak(), best = bestStreak();
    const pStreak = streak((k) => (peek(k)?.notes.length || 0) > 0);
    const sStreak = streak((k) => scores(k).sleep >= 1);
    const mStreak = streak((k) => scores(k).move >= 1);
    const wk = lastN(7).map((k) => scores(k).total), pw = lastN(14).slice(0, 7).map((k) => scores(k).total);
    const avg = (a) => Math.round(a.reduce((x, y) => x + y, 0) / a.length);
    const dAvg = avg(wk) - avg(pw);
    const left = daysBetween(t, S().launchDate);
    const kpi = (label, val, note, cls = '', pill = '') =>
      `<div class="kpi" ${pill ? `data-pillar="${pill}"` : ''}><div class="k-label">${pill ? '<span class="dot"></span>' : ''}${label}</div><div class="k-val">${val}</div><div class="k-note ${cls}">${note}</div></div>`;
    $('#kpis').innerHTML =
      kpi('Win streak', `🔥 ${st}`, `best ${best} days · 2 of 3 goals`) +
      kpi('Week score', avg(wk), dAvg === 0 ? 'same as last week' : `${dAvg > 0 ? '▲' : '▼'} ${Math.abs(dAvg)} vs last week`, dAvg > 0 ? 'up' : dAvg < 0 ? 'down' : '') +
      kpi('Picoq', left >= 0 ? `${left}d` : 'Live?', `to launch · ${pStreak}-day work streak`, '', 'picoq') +
      kpi('Sleep', `${sStreak}d`, 'on-time streak', '', 'sleep') +
      kpi('Move', `${mStreak}d`, `${S().moveTarget}-min streak`, '', 'move') +
      kpi('Records', prIndex().all.filter((p) => prIndex().flagged[p.id] === 'pr').length, 'PRs broken so far', '', 'move');
  }

  function renderDash() {
    chartJourney();
    renderWeek();
    if ($('#more-details').open) renderDetails();
  }
  function renderDetails() {
    renderKPIs();
    chartScore();
    chartHeat();
    chartLaunch();
    chartTime('#chart-wake', '#wake-sub', 'wake', S().wakeTarget, 'wake-up');
    chartTime('#chart-bed', '#bed-sub', 'bed', S().sleepTarget, 'bedtime');
    chartMove();
    chartPR();
  }

  function renderJournal() {
    const keys = Object.keys(state.days).filter((k) => state.days[k].notes.length).sort().reverse();
    if (!keys.length) { $('#journal').innerHTML = '<p class="j-empty">Nothing yet. Log your first Picoq step on the Today tab.</p>'; return; }
    const total = keys.reduce((a, k) => a + state.days[k].notes.length, 0);
    $('#journal').innerHTML = `<p class="sub"><b>${total}</b> actions over <b>${keys.length}</b> days.</p>` +
      keys.map((k) => `<div class="j-day"><div class="j-date">${fmtLong(k)}<span>${state.days[k].notes.length} ✓</span></div>
      <ul>${state.days[k].notes.map((n) => `<li>${esc(n.text)}</li>`).join('')}</ul></div>`).join('');
  }

  function renderSettings() {
    const f = $('#settings-form');
    for (const [k, v] of Object.entries(S())) if (f.elements[k]) f.elements[k].value = v;
  }

  function render() {
    renderHeader();
    if (tab === 'today') renderToday();
    if (tab === 'dash') renderDash();
    if (tab === 'journal') renderJournal();
    if (tab === 'settings') renderSettings();
  }

  // ---------- celebration ----------
  function toast(msg) {
    const t = $('#toast');
    t.textContent = msg; t.hidden = false;
    clearTimeout(toast.h); toast.h = setTimeout(() => (t.hidden = true), 2600);
  }
  function confetti() {
    if (matchMedia('(prefers-reduced-motion: reduce)').matches) return;
    const c = $('#confetti'), ctx = c.getContext('2d');
    const dpr = devicePixelRatio || 1;
    c.width = innerWidth * dpr; c.height = innerHeight * dpr; ctx.scale(dpr, dpr);
    const cols = ['#3987e5', '#d95926', '#199e70', '#fab219', '#9085e9', '#e87ba4'];
    const ps = Array.from({ length: 140 }, () => ({
      x: innerWidth / 2 + (Math.random() - 0.5) * 80, y: innerHeight * 0.35,
      vx: (Math.random() - 0.5) * 12, vy: -Math.random() * 12 - 4, s: 5 + Math.random() * 5,
      r: Math.random() * 6, vr: (Math.random() - 0.5) * 0.3, c: cols[(Math.random() * cols.length) | 0],
    }));
    let frameN = 0;
    (function tick() {
      ctx.clearRect(0, 0, innerWidth, innerHeight);
      for (const p of ps) {
        p.vy += 0.35; p.vx *= 0.99; p.x += p.vx; p.y += p.vy; p.r += p.vr;
        ctx.save(); ctx.translate(p.x, p.y); ctx.rotate(p.r); ctx.fillStyle = p.c; ctx.fillRect(-p.s / 2, -p.s / 4, p.s, p.s / 2); ctx.restore();
      }
      if (++frameN < 150) requestAnimationFrame(tick); else ctx.clearRect(0, 0, innerWidth, innerHeight);
    })();
    if (navigator.vibrate) navigator.vibrate([20, 40, 20]);
  }
  // Compare before/after a mutation and celebrate newly closed rings.
  function mutate(fn) {
    const before = scores(current);
    fn();
    save();
    const after = scores(current);
    const names = { picoq: 'Picoq ring closed! 💙', sleep: 'Sleep on track! 🌙', move: 'Hour of movement done! 💪' };
    if (after.hits === 3 && before.hits < 3) { confetti(); toast('All three goals done today! 🎉'); }
    else for (const p of ['picoq', 'sleep', 'move']) if (after[p] >= 1 && before[p] < 1) { toast(names[p]); break; }
    render();
  }

  // ---------- events ----------
  $$('.tabbar button').forEach((b) => b.addEventListener('click', () => {
    tab = b.dataset.tab;
    $$('.tabbar button').forEach((x) => x.classList.toggle('active', x === b));
    $$('.view').forEach((v) => (v.hidden = v.dataset.view !== tab));
    hideTip();
    scrollTo({ top: 0 });
    render();
  }));

  $('#prev-day').addEventListener('click', () => { current = addDays(current, -1); render(); });
  $('#next-day').addEventListener('click', () => { if (current < todayKey()) { current = addDays(current, 1); render(); } });
  $('#date-pill').addEventListener('click', () => { current = todayKey(); render(); });

  function addNote(text) {
    text = text.trim();
    if (!text) return;
    mutate(() => day(current).notes.push({ id: uid(), text, ts: Date.now() }));
  }
  $('#picoq-form').addEventListener('submit', (e) => { e.preventDefault(); addNote($('#picoq-input').value); $('#picoq-input').value = ''; });
  $('#picoq-quick').addEventListener('click', (e) => {
    const b = e.target.closest('button'); if (!b) return;
    const inp = $('#picoq-input');
    if (inp.value.trim()) { addNote(`${b.dataset.q}: ${inp.value}`); inp.value = ''; }
    else { inp.value = `${b.dataset.q}: `; inp.focus(); }
  });
  $('#picoq-list').addEventListener('click', (e) => {
    const id = e.target.dataset.delNote; if (!id) return;
    mutate(() => { const d = day(current); d.notes = d.notes.filter((n) => n.id !== id); });
  });

  $('#ms-form').addEventListener('submit', (e) => {
    e.preventDefault();
    const v = $('#ms-input').value.trim(); if (!v) return;
    mutate(() => state.milestones.push({ id: uid(), title: v, done: false, doneDate: null }));
    $('#ms-input').value = '';
  });
  $('#ms-list').addEventListener('change', (e) => {
    const m = state.milestones.find((x) => x.id === e.target.dataset.ms); if (!m) return;
    mutate(() => { m.done = e.target.checked; m.doneDate = m.done ? current : null; });
    if (m.done) { confetti(); toast(`Milestone reached: ${m.title}`); }
  });
  $('#ms-list').addEventListener('click', (e) => {
    const id = e.target.dataset.delMs; if (!id) return;
    if (confirm('Remove this milestone?')) mutate(() => (state.milestones = state.milestones.filter((m) => m.id !== id)));
  });

  $('#bed-input').addEventListener('change', (e) => mutate(() => (day(current).bed = e.target.value)));
  $('#wake-input').addEventListener('change', (e) => mutate(() => (day(current).wake = e.target.value)));
  $$('[data-now]').forEach((b) => b.addEventListener('click', (e) => {
    e.preventDefault();
    const n = new Date(), v = `${pad2(n.getHours())}:${pad2(n.getMinutes())}`;
    mutate(() => (day(current)[b.dataset.now] = v));
  }));

  const setMove = (v) => mutate(() => (day(current).move = Math.max(0, Math.min(600, Math.round(v) || 0))));
  $('#move-input').addEventListener('change', (e) => setMove(Number(e.target.value)));
  $$('.step').forEach((b) => b.addEventListener('click', () => setMove((Number(peek(current)?.move) || 0) + Number(b.dataset.min))));
  $('#move-type').addEventListener('click', (e) => {
    const b = e.target.closest('button'); if (!b) return;
    mutate(() => { const d = day(current); d.moveType = d.moveType === b.dataset.t ? '' : b.dataset.t; });
  });

  $('#pr-form').addEventListener('submit', (e) => {
    e.preventDefault();
    const ex = $('#pr-ex').value.trim(), val = Number($('#pr-val').value), unit = $('#pr-unit').value, lower = $('#pr-lower').checked;
    if (!ex || !Number.isFinite(val)) return;
    const id = uid();
    mutate(() => day(current).prs.push({ id, ex, val, unit, lower }));
    if (prIndex().flagged[id] === 'pr') { confetti(); toast(`NEW PR — ${ex}: ${val} ${unit}! 🏆`); }
    $('#pr-val').value = '';
  });
  $('#pr-ex').addEventListener('change', () => {
    // remember unit / direction from the last entry of this exercise
    const last = prIndex().all.filter((p) => p.ex.trim().toLowerCase() === $('#pr-ex').value.trim().toLowerCase()).pop();
    if (last) { $('#pr-unit').value = last.unit; $('#pr-lower').checked = !!last.lower; }
  });
  $('#pr-list').addEventListener('click', (e) => {
    const id = e.target.dataset.delPr; if (!id) return;
    mutate(() => { const d = day(current); d.prs = d.prs.filter((p) => p.id !== id); });
  });
  $('#pr-select').addEventListener('change', chartPR);
  $('#more-details').addEventListener('toggle', (e) => e.target.open && renderDetails());

  $('#settings-form').addEventListener('submit', (e) => {
    e.preventDefault();
    const f = e.target.elements;
    state.settings = {
      name: f.name.value.trim(), startDate: f.startDate.value || S().startDate, launchDate: f.launchDate.value || S().launchDate,
      sleepTarget: f.sleepTarget.value || S().sleepTarget, wakeTarget: f.wakeTarget.value || S().wakeTarget,
      tolerance: Math.max(5, Number(f.tolerance.value) || 30), moveTarget: Math.max(10, Number(f.moveTarget.value) || 60),
    };
    save(); render(); toast('Goals saved');
  });
  $('#export-btn').addEventListener('click', () => {
    const blob = new Blob([JSON.stringify(state, null, 2)], { type: 'application/json' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob); a.download = `believing-me-${todayKey()}.json`; a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 1000);
  });
  $('#import-file').addEventListener('change', async (e) => {
    const file = e.target.files[0]; if (!file) return;
    try {
      const s = JSON.parse(await file.text());
      if (!s.days || !s.settings) throw new Error('bad file');
      if (!confirm('Replace everything on this device with this backup?')) return;
      state = { settings: { ...defaults().settings, ...s.settings }, milestones: s.milestones || [], days: s.days };
      save(); render(); toast('Backup restored');
    } catch { toast('That file is not a Believing Me backup'); }
    e.target.value = '';
  });
  $('#reset-btn').addEventListener('click', () => {
    if (confirm('Erase ALL data on this device? Export a backup first if unsure.')) { state = defaults(); save(); render(); toast('Fresh start'); }
  });

  let deferredInstall = null;
  addEventListener('beforeinstallprompt', (e) => { e.preventDefault(); deferredInstall = e; $('#install-btn').hidden = false; });
  $('#install-btn').addEventListener('click', async () => {
    if (!deferredInstall) return;
    deferredInstall.prompt(); await deferredInstall.userChoice; deferredInstall = null; $('#install-btn').hidden = true;
  });

  let rt;
  addEventListener('resize', () => { clearTimeout(rt); rt = setTimeout(() => tab === 'dash' && renderDash(), 150); });
  document.addEventListener('scroll', hideTip, { passive: true });
  // Roll over to the new day when the app is reopened after midnight.
  let lastToday = todayKey();
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState !== 'visible') return;
    if (todayKey() !== lastToday) { if (current === lastToday) current = todayKey(); lastToday = todayKey(); }
    render();
  });

  if ('serviceWorker' in navigator && location.protocol !== 'file:') {
    addEventListener('load', () => navigator.serviceWorker.register('sw.js').catch(() => {}));
  }

  render();
})();
