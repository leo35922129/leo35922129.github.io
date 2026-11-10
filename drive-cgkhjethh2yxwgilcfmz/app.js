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
    <div class="bar"><div class="b" style="width:${Math.round(100 * (x.gas || 0) / max)}%;background:#3a4150"><div class="b" style="margin:0;width:${x.gas ? Math.round(100 * (x.elec || 0) / x.gas) : 0}%;background:var(--acc)"></div></div>
    <div class="l"><span>${x.n || 0} trips · ${num(x.mi || 0, 1)} mi</span><span>${money(x.elec || 0)} / ${money(x.gas || 0)}</span></div></div>
    <div class="r"><div class="g">${money(x.save || 0)}</div><div style="color:var(--mut);font-size:11px">saved</div></div></div>`).join('') +
    '<p class="empty" style="padding:6px 0;font-size:12px">Blue = electric cost, grey = what premium gas would cost</p>';
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
function tripCard(t) {
  return `<div class="trip"><div class="hd"><span>${timeTs(t.s)}${t.est ? '<span class="tag"> ~start</span>' : ''} – ${timeTs(t.e)}</span><span>${t.min} min</span></div>
  <div class="rt"><div>${esc(t.from)}</div><div>${esc(t.to)}</div></div>
  <div class="tg"><div><b>${num(t.mi, 2)}</b><span>mi</span></div><div><b>${t.soc0 ?? '–'}→${t.soc1 ?? '–'}%</b><span>battery</span></div>
  <div><b>${num(t.kwh, 2)}</b><span>kWh</span></div><div><b>${t.whmi ?? '–'}</b><span>Wh/mi</span></div></div>
  <div class="money"><span>⚡ ${money(t.elec)}${t.cest ? '<span class="tag"> est</span>' : ''}</span><span>⛽ ${money(t.gas)}</span><span class="g">Saved ${money(t.save)}</span></div>
  <div style="color:var(--mut);font-size:11px;margin-top:6px">Battery energy ${t.rate ? '$' + t.rate.toFixed(3) + '/kWh' : ''} · premium ${t.gp ? '$' + t.gp.toFixed(2) : ''}/gal (${esc(t.garea || '')}) @ ${S.meta.mpg} mpg</div></div>`;
}
function chargeCard(c) {
  const kind = { home: '🏠 Home charging', supercharger: '⚡ Supercharger', other: '🔌 Public charger' }[c.kind] || c.kind;
  const tou = c.tou ? Object.entries(c.tou).map(([p, v]) => `${p} ${num(v.kwh, 1)} kWh ${money(v.cost)}`).join(' · ') : '';
  return `<div class="trip"><div class="hd"><span>${kind}</span><span>${timeTs(c.s)} – ${timeTs(c.e)}</span></div>
  <div style="margin:8px 0">${esc(c.where || '')}</div>
  <div class="money"><span>+${num(c.kwh, 1)} kWh${c.wall ? ` (${num(c.wall, 1)} from wall)` : ''}</span><span>${c.soc0 != null ? c.soc0 + '→' + c.soc1 + '%' : ''}</span><span class="g" style="color:var(--tx)">${money(c.cost)}</span></div>
  <div style="color:var(--mut);font-size:11px;margin-top:6px">${esc(c.src === 'tesla' ? 'Tesla Supercharger bill' : (c.src || ''))}${tou ? ' · ' + tou : ''}${c.est ? ' · estimated' : ''}</div></div>`;
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
