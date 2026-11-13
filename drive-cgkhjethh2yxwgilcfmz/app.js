'use strict';
const TZ = 'America/Detroit';
const $ = s => document.querySelector(s);
const S = { view: localStorage.getItem('ht_view') || 'month', cur: new Date(), meta: null, months: {}, key: null };
const money = v => (v == null ? '–' : (v < 0 ? '-$' : '$') + Math.abs(v).toFixed(2));
const num = (v, d = 1) => (v == null ? '–' : (+v).toFixed(d));
const MONTHS = ['January','February','March','April','May','June','July','August','September','October','November','December'];
const DOW = ['Sun','Mon','Tue','Wed','Thu','Fri','Sat'];
const pad = n => String(n).padStart(2, '0');
const keyOf = d => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const fmtParts = new Intl.DateTimeFormat('en-CA', { timeZone: TZ, year: 'numeric', month: '2-digit', day: '2-digit' });
const dayKeyTs = ts => fmtParts.format(new Date(ts * 1000));
const timeTs = ts => new Date(ts * 1000).toLocaleTimeString('en-US', { timeZone: TZ, hour: 'numeric', minute: '2-digit' });
const todayD = () => { const [y, m, d] = fmtParts.format(new Date()).split('-').map(Number); return new Date(y, m - 1, d); };
const addDays = (d, n) => { const x = new Date(d); x.setDate(x.getDate() + n); return x; };
const weekStart = d => addDays(d, -d.getDay());

// ---------- crypto ----------
const b64 = s => Uint8Array.from(atob(s), c => c.charCodeAt(0));
const hex = s => new Uint8Array(s.match(/../g).map(h => parseInt(h, 16)));
async function deriveKey(pass, saltHex, iter) {
  const base = await crypto.subtle.importKey('raw', new TextEncoder().encode(pass), 'PBKDF2', false, ['deriveBits']);
  const bits = await crypto.subtle.deriveBits({ name: 'PBKDF2', hash: 'SHA-256', salt: hex(saltHex), iterations: iter }, base, 256);
  return new Uint8Array(bits);
}
async function decrypt(blob, raw) {
  const k = await crypto.subtle.importKey('raw', raw, 'AES-GCM', false, ['decrypt']);
  const pt = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: b64(blob.iv) }, k, b64(blob.ct));
  const ds = new Blob([pt]).stream().pipeThrough(new DecompressionStream('gzip'));
  return JSON.parse(await new Response(ds).text());
}
async function getBlob(path) {
  const r = await fetch(path + '?t=' + Date.now(), { cache: 'no-store' });
  if (!r.ok) throw new Error('fetch ' + path + ' ' + r.status);
  return r.json();
}
async function unlock(pass) {
  const blob = await getBlob('d/meta.json');
  const raw = await deriveKey(pass, blob.salt, blob.iter);
  const meta = await decrypt(blob, raw);  // throws if wrong passcode
  localStorage.setItem('ht_key', btoa(String.fromCharCode(...raw)));
  localStorage.setItem('ht_salt', blob.salt);
  S.key = raw; S.meta = meta;
}
async function loadMeta() {
  const blob = await getBlob('d/meta.json');
  if (blob.salt !== localStorage.getItem('ht_salt')) throw new Error('salt changed');
  S.meta = await decrypt(blob, S.key);
}
async function month(ym) {
  if (S.months[ym]) return S.months[ym];
  if (!S.meta.months.includes(ym)) return (S.months[ym] = { trips: [], charges: [] });
  S.months[ym] = await decrypt(await getBlob(`d/${ym}.json`), S.key);
  return S.months[ym];
}

// ---------- aggregates ----------
function sumDays(keys) {
  const t = { mi: 0, kwh: 0, elec: 0, gas: 0, save: 0, n: 0, chg: 0, min: 0 };
  for (const k of keys) { const d = S.meta.days[k]; if (d) for (const f in t) t[f] += d[f] || 0; }
  return t;
}
function rangeKeys(a, b) { const out = []; for (let d = new Date(a); d <= b; d = addDays(d, 1)) out.push(keyOf(d)); return out; }
function periodRange() {
  const c = S.cur;
  if (S.view === 'day') return [c, c];
  if (S.view === 'week') { const s = weekStart(c); return [s, addDays(s, 6)]; }
  if (S.view === 'month') return [new Date(c.getFullYear(), c.getMonth(), 1), new Date(c.getFullYear(), c.getMonth() + 1, 0)];
  return [new Date(c.getFullYear(), 0, 1), new Date(c.getFullYear(), 11, 31)];
}
function renderSummary() {
  const [a, b] = periodRange(); const t = sumDays(rangeKeys(a, b));
  const whmi = t.mi ? Math.round(t.kwh * 1000 / t.mi) : null;
  $('#summary').innerHTML = [
    ['Electric spent', money(t.elec), ''], ['Gas would cost', money(t.gas), ''], ['Saved', money(t.save), 'grn'],
    ['Miles', num(t.mi, 1), ''], ['Energy', num(t.kwh, 1) + ' kWh', ''], ['Efficiency', whmi ? whmi + ' Wh/mi' : '–', ''],
  ].map(([k, v, c]) => `<div class="stat"><div class="k">${k}</div><div class="v ${c}">${v}</div></div>`).join('');
}

// ---------- views ----------
function setTitle() {
  const c = S.cur; let t;
  if (S.view === 'day') t = c.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric', year: 'numeric' });
  else if (S.view === 'week') { const s = weekStart(c), e = addDays(s, 6); t = `${s.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })} – ${e.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}`; }
  else if (S.view === 'month') t = `${MONTHS[c.getMonth()]} ${c.getFullYear()}`;
  else t = String(c.getFullYear());
  $('#title').textContent = t;
  document.querySelectorAll('#seg button').forEach(b => b.classList.toggle('on', b.dataset.v === S.view));
}
function viewMonth() {
  const c = S.cur, first = new Date(c.getFullYear(), c.getMonth(), 1), start = weekStart(first), tk = keyOf(todayD());
  let h = `<div class="dow">${DOW.map(d => `<div>${d[0]}</div>`).join('')}</div><div class="grid">`;
  for (let i = 0; i < 42; i++) {
    const d = addDays(start, i); if (i >= 35 && d.getMonth() !== c.getMonth()) break;
    const k = keyOf(d), x = S.meta.days[k];
    h += `<div class="cell ${d.getMonth() !== c.getMonth() ? 'out' : ''} ${k === tk ? 'today' : ''}" data-day="${k}"><div class="n">${d.getDate()}</div>` +
      (x && x.n ? `<div class="s">${money(x.save)}</div><div class="m">${num(x.mi, 0)} mi</div>` : (x && x.chg ? '<div class="dot"></div>' : '')) + '</div>';
  }
  return h + '</div><p class="empty" style="padding:10px 0;font-size:12px">Green = saved vs. gas that day · tap a day for trips</p>';
}
function viewWeek() {
  const s = weekStart(S.cur); const rows = []; let max = 0.01;
  for (let i = 0; i < 7; i++) { const d = addDays(s, i), x = S.meta.days[keyOf(d)] || {}; max = Math.max(max, x.gas || 0); rows.push([d, x]); }
  return rows.map(([d, x]) => `<div class="row" data-day="${keyOf(d)}"><div class="d"><span>${DOW[d.getDay()]}</span><b>${d.getDate()}</b></div>
    <div class="bar"><div class="b" style="width:${Math.round(100 * (x.gas || 0) / max)}%;background:rgba(220,60,60,.55)"><div class="b" style="margin:0;width:${x.gas ? Math.round(100 * (x.elec || 0) / x.gas) : 0}%;background:#f5c518"></div></div>
    <div class="l"><span>${x.n || 0} trips · ${num(x.mi || 0, 1)} mi</span><span>${money(x.elec || 0)} / ${money(x.gas || 0)}</span></div></div>
    <div class="r"><div class="g">${money(x.save || 0)}</div><div style="color:var(--mut);font-size:11px">saved</div></div></div>`).join('') +
    '<p class="empty" style="padding:6px 0;font-size:12px">Yellow = electric cost, red = what premium gas would cost</p>';
}
function viewYear() {
  const y = S.cur.getFullYear(); let h = '<div class="year">';
  for (let m = 0; m < 12; m++) {
    const first = new Date(y, m, 1), last = new Date(y, m + 1, 0), t = sumDays(rangeKeys(first, last));
    let mini = DOW.map(d => `<i>${d[0]}</i>`).join('') + '<i></i>'.repeat(first.getDay());
    for (let d = 1; d <= last.getDate(); d++) { const x = S.meta.days[keyOf(new Date(y, m, d))]; mini += `<i class="${x && x.n ? 'has' : ''}">${d}</i>`; }
    h += `<div class="mon" data-month="${m}"><h3>${MONTHS[m].slice(0, 3)}</h3><div class="mini">${mini}</div>
      <div class="t"><span>${money(t.elec)} · ${num(t.mi, 0)} mi</span><span class="g">${money(t.save)}</span></div></div>`;
  }
  return h + '</div>';
}
const socI = v => v == null || v === '' || isNaN(+v) ? '–' : Math.trunc(+v);   // battery %: integer part only (54.7 -> 54)
const TRIPS = {};
function tripCard(t) {
  TRIPS[t.id] = t;
  const hasMap = (t.route && t.route.length > 1) || (t.gps && t.gps.length > 1);
  return `<div class="trip" data-trip="${t.id}"><div class="hd cap"><span>${timeTs(t.s)}${t.est ? '<span class="tag"> ~start</span>' : ''} – ${timeTs(t.e)}</span><span>${t.min} min</span></div>
  <div class="rt"><div>${esc(t.from)}</div><div>${esc(t.to)}</div></div>
  <div class="tg tt"><div><b>${num(t.mi, 2)}</b><span>mi</span></div><div><b>${socI(t.soc0)}→${socI(t.soc1)}%</b><span>battery</span></div>
  <div><b>${num(t.kwh, 2)}</b><span>kWh</span></div><div><b>${t.whmi ?? '–'}</b><span>Wh/mi</span></div></div>
  ${t.fsd ? `<div class="fsdbar"><span>FSD</span><div class="fb"><div style="width:${t.fsd.pct}%"></div></div><b>${t.fsd.pct}%</b><span>${num(t.fsd.mi, 0)} of ${num(t.mi, 0)} mi</span></div>` : ''}
  <div class="money tm"><span>⚡ ${money(t.elec)}${t.cest ? '<span class="tag"> est</span>' : ''}</span><span>⛽ ${money(t.gas)}</span><span class="g">Saved ${money(t.save)}</span></div>
  <div class="cap ratecap">${t.rate ? '$' + t.rate.toFixed(3) + '/kWh' : ''} · premium ${t.gp ? '$' + t.gp.toFixed(2) + '/gal' : ''} ${esc(t.garea || '')} · ${S.meta.mpg} mpg</div>
  ${hasMap ? `<div class="routebox"><button type="button" class="maptoggle" aria-expanded="false"><svg class="mico" viewBox="0 0 24 24" width="20" height="20" aria-hidden="true"><g fill="none" stroke="currentColor" stroke-width="2" stroke-linejoin="round" stroke-linecap="round"><path d="M9 4 3 6.5v13L9 17l6 2.5 6-2.5V4l-6 2.5z"/><path d="M9 4v13M15 6.5v13"/></g></svg><span class="ml">Show route &amp; playback</span><svg class="chev" viewBox="0 0 24 24" width="22" height="22" aria-hidden="true"><path d="m6 9 6 6 6-6" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"/></svg></button><div class="rbody"><div class="rinner"><div class="map" id="map-${t.id}"></div></div></div></div>` : ''}
  </div>`;
}
function chargeCard(c) {
  const kind = { home: '🏠 Home charging', supercharger: '⚡ Supercharger', other: '🔌 Public charger' }[c.kind] || c.kind;
  const tou = c.tou ? Object.entries(c.tou).map(([p, v]) => `${p} ${num(v.kwh, 1)} kWh ${money(v.cost)}`).join(' · ') : '';
  return `<div class="trip"><div class="hd cap"><span>${kind}</span><span>${timeTs(c.s)} – ${timeTs(c.e)}</span></div>
  <div style="margin:8px 0">${esc(c.where || '')}</div>
  <div class="money"><span>+${num(c.kwh, 1)} kWh${c.wall ? ` (${num(c.wall, 1)} from wall)` : ''}</span><span>${c.soc0 != null ? socI(c.soc0) + '→' + socI(c.soc1) + '%' : ''}</span><span class="g" style="color:var(--tx)">${money(c.cost)}</span></div>
  <div style="color:var(--mut);font-size:11px;margin-top:6px">${esc(c.src === 'tesla' ? 'Tesla Supercharger bill' : (c.src || ''))}${c.note ? ' · ' + esc(c.note) : ''}${tou ? ' · ' + tou : ''}${c.est ? ' · estimated' : ''}</div></div>`;
}
const MAPS = {};
function pinEl(color, ring) {
  const d = document.createElement('div');
  d.style.cssText = `width:14px;height:14px;border-radius:50%;background:${color};border:3px solid ${ring};box-shadow:0 0 0 1px rgba(0,0,0,.5)`;
  return d;
}
function toggleMap(id) {
  const t = TRIPS[id], el = document.getElementById('map-' + id); if (!el) return;
  const box = el.closest('.routebox'), open = !box.classList.contains('open');
  box.classList.toggle('open', open);
  const mt = box.querySelector('.maptoggle');
  mt.classList.toggle('open', open); mt.setAttribute('aria-expanded', open);
  mt.querySelector('.ml').textContent = open ? 'Hide route' : 'Show route & playback';
  if (!open && PLAYERS[id]) PLAYERS[id].pause();
  if (!open || MAPS[id]) { if (MAPS[id]) setTimeout(() => MAPS[id].resize(), 350); return; }
  const line = ((t.route && t.route.length > 1) ? t.route : t.gps).map(p => [p[1], p[0]]);
  const gps = (t.gps || []).map(p => [p[1], p[0]]);
  const est = t.rsrc === 'estimated' || (!t.route && t.rsrc !== 'gps' && t.rsrc !== 'tessie');
  const all = line.concat(gps), bounds = new maplibregl.LngLatBounds(all[0], all[0]);
  all.forEach(c => bounds.extend(c));
  const m = new maplibregl.Map({ container: el, style: 'https://tiles.openfreemap.org/styles/dark', bounds,
    fitBoundsOptions: { padding: { top: 64, bottom: 30, left: 30, right: 30 } }, attributionControl: { compact: true }, cooperativeGestures: true, dragRotate: false, pitchWithRotate: false });
  const flags = (t.gps || []).map(p => p.length > 2 ? p[2] : null);
  const hasFsd = flags.some(f => f === 1);
  m.on('load', () => {
    const at = el.querySelector('.maplibregl-ctrl-attrib'); if (at) at.classList.remove('maplibregl-compact-show');
    const feats = [];
    if (hasFsd) {   // colour the GPS breadcrumb by FSD state
      let seg = [gps[0]], cur = flags[1] === 1;
      for (let i = 1; i < gps.length; i++) {
        const f = flags[i] === 1;
        if (f !== cur) { feats.push({ type: 'Feature', properties: { fsd: cur ? 1 : 0 }, geometry: { type: 'LineString', coordinates: seg } }); seg = [gps[i - 1]]; cur = f; }
        seg.push(gps[i]);
      }
      feats.push({ type: 'Feature', properties: { fsd: cur ? 1 : 0 }, geometry: { type: 'LineString', coordinates: seg } });
    } else feats.push({ type: 'Feature', properties: { fsd: 0 }, geometry: { type: 'LineString', coordinates: line } });
    m.addSource('route', { type: 'geojson', data: { type: 'FeatureCollection', features: feats } });
    const paint = { 'line-color': ['case', ['==', ['get', 'fsd'], 1], '#2fd5a0', '#3e8bff'], 'line-width': ['case', ['==', ['get', 'fsd'], 1], 6, 5], 'line-opacity': .95 };
    if (est) paint['line-dasharray'] = [1.5, 1.5];
    m.addLayer({ id: 'route', type: 'line', source: 'route', layout: { 'line-cap': 'round', 'line-join': 'round' }, paint });
  });
  if (hasFsd) for (let i = 1; i < gps.length; i++) {
    if (flags[i] === 1 && flags[i - 1] !== 1) new maplibregl.Marker({ element: pinEl('#2fd5a0', '#0b4d3a') }).setLngLat(gps[i - 1]).setPopup(new maplibregl.Popup({ closeButton: false }).setText('FSD engaged (≈ within 1 mi)')).addTo(m);
    if (flags[i] !== 1 && flags[i - 1] === 1) new maplibregl.Marker({ element: pinEl('#ffb340', '#6b4300') }).setLngLat(gps[i - 1]).setPopup(new maplibregl.Popup({ closeButton: false }).setText('FSD off / took over (≈ within 1 mi)')).addTo(m);
  }
  const a = gps[0] || line[0], b = gps[gps.length - 1] || line[line.length - 1];
  new maplibregl.Marker({ element: pinEl('#c7ccd3', '#5a616b') }).setLngLat(a).setPopup(new maplibregl.Popup({ closeButton: false }).setText('Start · ' + timeTs(t.s))).addTo(m);
  new maplibregl.Marker({ element: pinEl('#ff4d4d', '#7a1c1c') }).setLngLat(b).setPopup(new maplibregl.Popup({ closeButton: false }).setText('End · ' + timeTs(t.e))).addTo(m);
  const note = document.createElement('div'); note.className = 'mapnote';
  if (hasFsd) note.innerHTML = '<span style="color:#2fd5a0">━ FSD</span> &nbsp;<span style="color:#3e8bff">━ manual</span> &nbsp;<span style="color:#2fd5a0">●</span> on <span style="color:#ffb340">●</span> off';
  else note.textContent = est ? 'Drive not fully recorded · likely route (dashed)' : `${gps.length} GPS fixes${t.rsrc === 'gps' ? '' : t.rsrc === 'tessie' ? ' (Tessie history)' : ', road-matched'}`;
  el.appendChild(note);
  MAPS[id] = m;
  if (gps.length > 1) setupPlayer(id, t, m, gps, flags, el, t.route && t.route.length > 1 ? line : null);
}

// ---------------- route playback ----------------
const PLAYERS = {};
const TRUCK_SVG = `<svg viewBox="0 0 24 48" width="22" height="44" aria-hidden="true">
  <polygon points="6,2 18,2 21,7 21,44 19,46.5 5,46.5 3,44 3,7" fill="#c9ced6" stroke="#15181d" stroke-width="1.2" stroke-linejoin="round"/>
  <rect x="5.5" y="2.6" width="13" height="1.3" rx=".4" fill="#f4f7fb"/>
  <polygon points="2,12 3,11 3,14" fill="#9aa1ab"/><polygon points="22,12 21,11 21,14" fill="#9aa1ab"/>
  <polygon points="5.5,9.5 18.5,9.5 17.5,20 6.5,20" fill="#20262e"/>
  <polygon points="6.5,20 17.5,20 17.5,26.5 6.5,26.5" fill="#aeb4bd"/>
  <polygon points="6.5,26.5 17.5,26.5 18.5,31 5.5,31" fill="#2a3038"/>
  <rect x="5.5" y="31.5" width="13" height="12.5" fill="#b9bfc8" stroke="#8e959f" stroke-width=".5"/>
  <line x1="5.5" y1="35.5" x2="18.5" y2="35.5" stroke="#8e959f" stroke-width=".5"/><line x1="5.5" y1="39.5" x2="18.5" y2="39.5" stroke="#8e959f" stroke-width=".5"/>
  <rect x="5" y="45.2" width="14" height="1" rx=".4" fill="#ff3b3b"/></svg>`;
const WHEEL_SVG = `<svg viewBox="0 0 24 24" width="20" height="20" aria-hidden="true"><g fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round">
  <circle cx="12" cy="12" r="9.5"/><circle cx="12" cy="12" r="2.6"/><path d="M2.8 11.2 L9.4 11.6 M14.6 11.6 L21.2 11.2 M12 14.6 L12 21.4"/></g></svg>`;
const toRad = d => d * Math.PI / 180;
function bearingDeg(a, b) {   // a, b = [lng, lat]
  const y = Math.sin(toRad(b[0] - a[0])) * Math.cos(toRad(b[1])),
    x = Math.cos(toRad(a[1])) * Math.sin(toRad(b[1])) - Math.sin(toRad(a[1])) * Math.cos(toRad(b[1])) * Math.cos(toRad(b[0] - a[0]));
  return (Math.atan2(y, x) * 180 / Math.PI + 360) % 360;
}
function distM(a, b) {
  const dLat = toRad(b[1] - a[1]), dLon = toRad(b[0] - a[0]);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(toRad(a[1])) * Math.cos(toRad(b[1])) * Math.sin(dLon / 2) ** 2;
  return 12742000 * Math.asin(Math.sqrt(h));
}
const clockTs = ts => new Date(ts * 1000).toLocaleTimeString('en-US', { timeZone: TZ, hour: 'numeric', minute: '2-digit', second: '2-digit' });
function stopPlayers() { for (const k in PLAYERS) { cancelAnimationFrame(PLAYERS[k].raf); delete PLAYERS[k]; } }
function setupPlayer(id, t, m, gps0, flags0, el, routeLine) {
  let raw = t.gps, gps = gps0, flags = flags0;
  const dur = Math.max(1, t.e - t.s);
  if (routeLine && routeLine.length > gps0.length) {
    // sparse fixes + road-snapped route: drive along the road; time each vertex by its nearest fix (else by distance)
    const fixT = t.gps.map(p => p.length > 3 ? p[3] : null), fixV = t.gps.map(p => p.length > 4 ? p[4] : null), fixB = t.gps.map(p => p.length > 5 ? p[5] : null);
    let k = 0;
    raw = routeLine.map(c => {
      let best = k, bd = Infinity;
      for (let j = k; j < gps0.length; j++) { const d = distM(c, gps0[j]); if (d < bd) { bd = d; best = j; } }
      if (bd < 60 && fixT[best] != null) { k = best; return [c[1], c[0], null, fixT[best], fixV[best], fixB[best]]; }
      return [c[1], c[0], null, null, null, null];
    });
    // fill missing times by distance between known anchors
    const cum = [0]; for (let i = 1; i < raw.length; i++) cum.push(cum[i - 1] + distM(routeLine[i - 1], routeLine[i]));
    const L = cum[cum.length - 1] || 1;
    raw[0][3] = 0; if (raw[raw.length - 1][3] == null) raw[raw.length - 1][3] = dur;
    let a = 0;
    for (let i = 1; i < raw.length; i++) if (raw[i][3] != null) {
      for (let j = a + 1; j < i; j++) raw[j][3] = raw[a][3] + (raw[i][3] - raw[a][3]) * (cum[j] - cum[a]) / ((cum[i] - cum[a]) || 1);
      a = i;
    }
    void L;
    gps = routeLine; flags = raw.map(() => null);
  }
  const n = gps.length;
  // per-point times (s from start): real where published, else spread by distance over the trip duration
  let T = raw.map(p => p.length > 3 && p[3] != null ? Math.max(0, p[3]) : null);
  if (T.some(v => v == null)) {
    const cum = [0]; for (let i = 1; i < n; i++) cum.push(cum[i - 1] + distM(gps[i - 1], gps[i]));
    const L = cum[n - 1] || 1; T = cum.map(c => c / L * dur);
  }
  for (let i = 1; i < n; i++) if (T[i] < T[i - 1]) T[i] = T[i - 1];
  const T0 = T[0]; T = T.map(v => v - T0);
  const total = Math.max(T[n - 1], 1);
  let V = raw.map(p => p.length > 4 ? p[4] : null);
  V = V.map((v, i) => {
    if (v != null) return v;
    const a = Math.max(0, i - 1), b = Math.min(n - 1, i + 1), dt = T[b] - T[a];
    return dt > 0 ? distM(gps[a], gps[b]) / dt * 2.23694 : 0;
  });
  // battery %: per-point where published, else interpolated in time between known values (trip start/end % as anchors)
  const B = raw.map(p => p.length > 5 && p[5] != null ? +p[5] : null);
  const known = [];
  if (B[0] == null && t.soc0 != null) known.push([0, +t.soc0]);
  B.forEach((b, i) => { if (b != null) known.push([T[i], b]); });
  if (B[n - 1] == null && t.soc1 != null) known.push([total, +t.soc1]);
  const batAt = tt => {
    if (!known.length) return null;
    if (tt <= known[0][0]) return known[0][1];
    for (let i = 1; i < known.length; i++) if (tt <= known[i][0]) {
      const [t0, b0] = known[i - 1], [t1, b1] = known[i];
      return t1 > t0 ? b0 + (b1 - b0) * (tt - t0) / (t1 - t0) : b1;
    }
    return known[known.length - 1][1];
  };
  const P = { pt: 0, playing: false, mode: 'auto', raf: 0, last: 0, brg: 0 };
  PLAYERS[id] = P;
  for (let i = 1; i < n; i++) if (distM(gps[0], gps[i]) > 3) { P.brg = bearingDeg(gps[0], gps[i]); break; }
  const tel = document.createElement('div'); tel.className = 'truck'; tel.innerHTML = TRUCK_SVG;
  const truck = new maplibregl.Marker({ element: tel, rotationAlignment: 'map', pitchAlignment: 'map', rotation: P.brg }).setLngLat(gps[0]).addTo(m);
  const badge = document.createElement('div'); badge.className = 'pbadge';
  badge.innerHTML = `<span class="clk"></span>`;
  el.appendChild(badge);
  const lab = document.createElement('div'); lab.className = 'tlabel';
  lab.innerHTML = `<span class="wheel">${WHEEL_SVG}</span><b class="spd">0</b><span class="u">mph</span><span class="sep"></span><b class="bat">–</b><span class="u">%</span>`;
  const label = new maplibregl.Marker({ element: lab, anchor: 'center' }).setLngLat(gps[0]).addTo(m);
  const bar = document.createElement('div'); bar.className = 'playbar';
  bar.innerHTML = `<div class="prow"><button class="pbtn play" aria-label="Play">▶</button><button class="pbtn rst" aria-label="Restart">↺</button>
    <input class="prange" type="range" min="0" max="1000" value="0" aria-label="Position"><span class="ptime"></span></div>`;
  el.after(bar);
  const $b = q => bar.querySelector(q), spd = lab.querySelector('.spd'), bat = lab.querySelector('.bat'), clk = badge.querySelector('.clk'), wheel = lab.querySelector('.wheel');
  function placeLabel(pos) {   // keep the label beside the truck but inside the map
    const W = el.clientWidth, H = el.clientHeight, w = lab.offsetWidth || 120, h = lab.offsetHeight || 28, gap = 20;
    const pt = m.project(pos);
    let dx = pt.x + gap + w <= W - 4 ? gap + w / 2 : -(gap + w / 2);
    if (pt.x + dx - w / 2 < 4) dx = 4 + w / 2 - pt.x;
    if (pt.x + dx + w / 2 > W - 4) dx = W - 4 - w / 2 - pt.x;
    let dy = 0;
    if (pt.y - h / 2 < 4) dy = 4 + h / 2 - pt.y;
    if (pt.y + h / 2 > H - 4) dy = H - 4 - h / 2 - pt.y;
    label.setLngLat(pos).setOffset([dx, dy]);
  }
  m.on('move', () => placeLabel(truck.getLngLat().toArray()));
  const rate = () => Math.max(1, total / 20);   // always: whole trip in ~20 s
  const fmtDur = s => `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, '0')}`;
  function draw() {
    let lo = 0, hi = n - 1;
    while (hi - lo > 1) { const mid = (lo + hi) >> 1; if (T[mid] <= P.pt) lo = mid; else hi = mid; }
    const seg = T[hi] - T[lo], f = seg > 0 ? Math.min(1, Math.max(0, (P.pt - T[lo]) / seg)) : 1;
    const a = gps[lo], b = gps[hi], pos = [a[0] + (b[0] - a[0]) * f, a[1] + (b[1] - a[1]) * f];
    if (distM(a, b) > 3) P.brg = bearingDeg(a, b);
    truck.setLngLat(pos).setRotation(P.brg); placeLabel(pos);
    const v = V[lo] + (V[hi] - V[lo]) * f, fsd = flags[hi] === 1, bv = batAt(P.pt);
    spd.textContent = Math.round(v);
    bat.textContent = socI(bv);
    wheel.className = 'wheel' + (fsd ? ' fsd' : '');
    wheel.title = fsd ? 'FSD' : 'Manual';
    clk.textContent = clockTs(t.s + P.pt);
    $b('.prange').value = Math.round(P.pt / total * 1000);
    $b('.ptime').textContent = `${fmtDur(P.pt)} / ${fmtDur(total)}`;
  }
  function frame(ts) {
    if (!P.playing) return;
    if (P.last) P.pt = Math.min(total, P.pt + (ts - P.last) / 1000 * rate());
    P.last = ts; draw();
    if (P.pt >= total) { setPlaying(false); return; }
    P.raf = requestAnimationFrame(frame);
  }
  function setPlaying(on) {
    P.playing = on; P.last = 0; cancelAnimationFrame(P.raf);
    $b('.play').textContent = on ? '❚❚' : '▶'; $b('.play').setAttribute('aria-label', on ? 'Pause' : 'Play');
    if (on) { if (P.pt >= total) P.pt = 0; P.raf = requestAnimationFrame(frame); }
  }
  P.pause = () => setPlaying(false);
  $b('.play').addEventListener('click', () => setPlaying(!P.playing));
  $b('.rst').addEventListener('click', () => { P.pt = 0; draw(); setPlaying(true); });
  $b('.prange').addEventListener('input', e => { P.pt = e.target.value / 1000 * total; draw(); });
  draw();
}
async function viewDay() {
  const k = keyOf(S.cur), m = await month(k.slice(0, 7));
  const trips = m.trips.filter(t => dayKeyTs(t.s) === k).sort((a, b) => a.s - b.s);
  const ch = m.charges.filter(c => dayKeyTs(c.s) === k).sort((a, b) => a.s - b.s);
  let h = trips.length ? trips.map(tripCard).join('') : '<div class="empty">No trips this day</div>';
  if (ch.length) h += '<h2>Charging</h2>' + ch.map(chargeCard).join('');
  return h;
}
const esc = s => String(s ?? '').replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

async function render() {
  stopPlayers();
  for (const k in MAPS) { try { MAPS[k].remove(); } catch (e) {} delete MAPS[k]; }
  localStorage.setItem('ht_view', S.view);
  setTitle(); renderSummary();
  const main = $('#main');
  try {
    main.innerHTML = S.view === 'day' ? await viewDay() : S.view === 'week' ? viewWeek() : S.view === 'month' ? viewMonth() : viewYear();
  } catch (e) { main.innerHTML = `<div class="empty">Couldn't load: ${esc(e.message)}</div>`; }
  const m = S.meta, upd = new Date(m.generated * 1000).toLocaleString('en-US', { timeZone: TZ, month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });
  $('#foot').innerHTML = `Updated ${upd} ET · DTE ${esc(m.plan)} · premium $${(+m.gas_home).toFixed(2)} · ${m.mpg} mpg${m.pending ? ` · <span class="tag">${m.pending} charge price to confirm</span>` : ''}<br><a href="#" id="info">How costs are calculated</a> · <a href="#" id="lockout">Lock</a>`;
  $('#info').onclick = e => { e.preventDefault(); showInfo(); };
  $('#lockout').onclick = e => { e.preventDefault(); localStorage.removeItem('ht_key'); location.reload(); };
}
function showInfo() {
  const m = S.meta, r = m.home_rates || {};
  $('#sheetbody').innerHTML = `<h3 style="margin-top:0">How costs are calculated</h3>
  <table><tr><td>Home plan</td><td>DTE ${esc(m.plan)} ${esc(m.plan_name)}</td></tr>
  ${Object.entries(r).map(([k, v]) => `<tr><td>Home ${k} (incl. PSCR)</td><td>${(v * 100).toFixed(2)}¢/kWh</td></tr>`).join('')}
  <tr><td>Energy now in battery</td><td>${m.battery_rate ? '$' + (+m.battery_rate).toFixed(3) + '/kWh' : '–'}</td></tr>
  <tr><td>Premium gas (home area)</td><td>$${(+m.gas_home).toFixed(2)}/gal</td></tr><tr><td>Gas comparison</td><td>${m.mpg} mpg</td></tr></table>
  <p style="color:var(--mut);font-size:13px">Each trip's electric cost = kWh used × the average cost of the energy in the battery. Home charging is priced minute by minute by DTE time-of-day period (with charging losses); Supercharger sessions use Tesla's actual bill; other chargers use the price you confirm. Gas cost = miles ÷ mpg × that day's local premium price (AAA metro average, adjusted to your ${esc(m.gas_station)} baseline at home). Saved = gas − electric.</p>
  <button class="pill" onclick="document.getElementById('sheet').classList.add('hidden')">Close</button>`;
  $('#sheet').classList.remove('hidden');
}
function move(dir) {
  const c = new Date(S.cur);
  if (S.view === 'day') c.setDate(c.getDate() + dir);
  else if (S.view === 'week') c.setDate(c.getDate() + 7 * dir);
  else if (S.view === 'month') { c.setDate(1); c.setMonth(c.getMonth() + dir); }
  else c.setFullYear(c.getFullYear() + dir);
  S.cur = c; render();
}
function wire() {
  $('#prev').onclick = () => move(-1); $('#next').onclick = () => move(1);
  $('#today').onclick = () => { S.cur = todayD(); render(); };
  document.querySelectorAll('#seg button').forEach(b => b.onclick = () => { S.view = b.dataset.v; render(); });
  $('#main').addEventListener('click', e => {
    const mt = e.target.closest('.maptoggle'); if (mt) { toggleMap(+mt.closest('.trip').dataset.trip); return; }
    const d = e.target.closest('[data-day]'), m = e.target.closest('[data-month]');
    if (d) { const [y, mo, da] = d.dataset.day.split('-').map(Number); S.cur = new Date(y, mo - 1, da); S.view = 'day'; render(); }
    else if (m) { S.cur = new Date(S.cur.getFullYear(), +m.dataset.month, 1); S.view = 'month'; render(); }
  });
  $('#sheet').onclick = e => { if (e.target.id === 'sheet') $('#sheet').classList.add('hidden'); };
  let x0 = null, y0 = null;
  document.addEventListener('touchstart', e => { x0 = e.touches[0].clientX; y0 = e.touches[0].clientY; }, { passive: true });
  document.addEventListener('touchend', e => {
    if (x0 == null) return; const dx = e.changedTouches[0].clientX - x0, dy = e.changedTouches[0].clientY - y0;
    if (Math.abs(dx) > 60 && Math.abs(dx) > 2 * Math.abs(dy) && $('#sheet').classList.contains('hidden')) move(dx < 0 ? 1 : -1);
    x0 = null;
  }, { passive: true });
  document.addEventListener('visibilitychange', async () => {
    if (document.visibilityState === 'visible' && S.key) { try { await loadMeta(); S.months = {}; render(); } catch (e) {} }
  });
}
async function start() {
  S.cur = todayD();
  const hash = new URLSearchParams(location.hash.slice(1));
  if (hash.get('k')) { try { await unlock(hash.get('k')); } catch (e) {} history.replaceState(null, '', location.pathname); }
  const saved = localStorage.getItem('ht_key');
  if (!S.meta && saved) { S.key = b64(saved); try { await loadMeta(); } catch (e) { S.meta = null; } }
  if (!S.meta) {
    $('#lock').classList.remove('hidden');
    $('#lockform').onsubmit = async e => {
      e.preventDefault(); $('#lockerr').textContent = 'Unlocking…';
      try { await unlock($('#pass').value.trim().toLowerCase()); $('#lock').classList.add('hidden'); show(); }
      catch (err) { $('#lockerr').textContent = 'That passcode didn\u2019t work.'; }
    };
    return;
  }
  show();
}
function show() { $('#app').classList.remove('hidden'); wire(); render(); }
if ('serviceWorker' in navigator) navigator.serviceWorker.register('sw.js').catch(() => {});
start();
