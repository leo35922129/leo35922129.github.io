'use strict';
const TZ = 'America/Detroit';
const $ = s => document.querySelector(s);
const S = {
  view: localStorage.getItem('ht_view') || 'month',
  mode: (localStorage.getItem('ht_mode') === 'energy' ? 'energy' : 'saving'),
  cur: new Date(), meta: null, months: {}, key: null
};
const money = v => (v == null ? '–' : (v < 0 ? '-$' : '$') + Math.abs(v).toFixed(2));
const num = (v, d = 1) => (v == null ? '–' : (+v).toFixed(d));
const esc = s => String(s ?? '').replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const fmtCom = (v, d = 1) => Number(v).toLocaleString('en-US', { minimumFractionDigits: d, maximumFractionDigits: d });
const fmtKwh = (v, d = 2) => (+v).toFixed(d);
const fmtW = w => (w == null ? '–' : Math.round(w).toLocaleString('en-US'));
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
const socI = v => v == null || v === '' || isNaN(+v) ? '–' : Math.round(+v);
const TRIPS = {};
const OPEN = new Set();
const energyMode = () => S.mode === 'energy';

function fmtSpan(s, e) {
  const m = Math.max(0, Math.round((e - s) / 60));
  const h = Math.floor(m / 60), mm = m % 60;
  if (h && mm) return h + ' hr ' + mm + ' min';
  if (h) return h + ' hr';
  return m + ' min';
}
function fmtMd(key) {
  if (!key) return '';
  const [y, m, d] = key.split('-').map(Number);
  return new Date(y, m - 1, d).toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
}

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
  const meta = await decrypt(blob, raw);
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
  if (!S.meta.months.includes(ym)) return (S.months[ym] = { trips: [], charges: [], parked: [], charge_slices: [] });
  S.months[ym] = await decrypt(await getBlob(`d/${ym}.json`), S.key);
  const m = S.months[ym];
  if (!m.parked) m.parked = [];
  if (!m.charge_slices) m.charge_slices = [];
  return m;
}

// ---------- aggregates ----------
function sumDays(keys) {
  const t = { mi: 0, kwh: 0, elec: 0, gas: 0, save: 0, n: 0, chg: 0, min: 0 };
  for (const k of keys) { const d = S.meta.days[k]; if (d) for (const f in t) t[f] += d[f] || 0; }
  return t;
}
function energySum(keys) {
  let driving = 0, parked = 0, known = false, charge = 0, parkedWkh = 0, parkedH = 0;
  for (const k of keys) {
    const d = S.meta.days[k]; if (!d) continue;
    driving += d.kwh || 0;
    charge += d.charge_added || 0;
    if (d.parked_known) {
      known = true;
      parked += d.parked || 0;
      if (d.parked_w && d.parked) {
        const hours = d.parked * 1000 / d.parked_w;
        if (hours > 0) { parkedWkh += d.parked; parkedH += hours; }
      }
    }
  }
  const total = known ? driving + parked : driving;
  return {
    driving, parked: known ? parked : null, known, total, charge_added: charge,
    parked_w: parkedH ? Math.round(parkedWkh * 1000 / parkedH) : null,
    whmi: sumDays(keys).mi ? Math.round(driving * 1000 / sumDays(keys).mi) : null
  };
}
function rangeKeys(a, b) { const out = []; for (let d = new Date(a); d <= b; d = addDays(d, 1)) out.push(keyOf(d)); return out; }
function periodRange() {
  const c = S.cur;
  if (S.view === 'day') return [c, c];
  if (S.view === 'week') { const s = weekStart(c); return [s, addDays(s, 6)]; }
  if (S.view === 'month') return [new Date(c.getFullYear(), c.getMonth(), 1), new Date(c.getFullYear(), c.getMonth() + 1, 0)];
  return [new Date(c.getFullYear(), 0, 1), new Date(c.getFullYear(), 11, 31)];
}

const SAVED_ICO = '<svg class="si" viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="11"/><text x="12" y="17.2" text-anchor="middle" font-family="-apple-system,BlinkMacSystemFont,Roboto,Arial,sans-serif" font-size="15.5" font-weight="800" fill="#0b2a14">$</text></svg>';
const DBADGE = '<span class="dbadge" aria-hidden="true">$</span>';
const WHEEL = '<svg class="ico" viewBox="0 0 24 24" fill="none" stroke="#3e8bff" stroke-width="1.85" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="12" cy="12" r="8.25"/><circle cx="12" cy="12" r="2.15"/><path d="M12 9.85V3.75M3.75 13h6.1M14.15 13h6.1"/></svg>';
const BOLT_ICO = '<svg class="ico" viewBox="0 0 24 24" aria-hidden="true"><path fill="#f5d031" d="M13.2 2.5 5.8 13.2h5.3l-.8 8.3 8.2-12.2h-5.4z"/></svg>';
const PLUG_ICO = '<svg class="ico" viewBox="0 0 24 24" aria-hidden="true"><path fill="currentColor" d="M3.2 10.15h6.6c.4 0 .7.3.7.7v2.3c0 .4-.3.7-.7.7H3.2c-.7 0-1.2-.5-1.2-1.15v-1.4c0-.65.5-1.15 1.2-1.15z"/><rect x="9.4" y="7.6" width="7" height="8.8" rx="1.8" fill="currentColor"/><rect x="16.2" y="9.15" width="4.6" height="1.7" rx=".7" fill="currentColor"/><rect x="16.2" y="13.15" width="4.6" height="1.7" rx=".7" fill="currentColor"/></svg>';
const PUMP_ICO = '<svg class="ico" viewBox="0 0 24 24" fill="none" stroke="#ff5a4e" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="3.8" y="3.5" width="9.2" height="16.5" rx="1.4"/><path d="M7 8h3.2M13 8.2h2.4c1.15 0 2.2.95 2.2 2.15V15"/><circle cx="17.6" cy="16.4" r="1.55" fill="#ff5a4e" stroke="none"/></svg>';
const PARK_ICO = '<svg class="ico" viewBox="0 0 24 24" aria-hidden="true"><rect x="3.2" y="3.2" width="17.6" height="17.6" rx="4.2" fill="#f0b040"/><path fill="#1a1408" d="M8.55 6.55h4.7c2.35 0 3.85 1.35 3.85 3.5 0 2.15-1.55 3.55-3.85 3.55h-2.1V17.45H8.55V6.55zm2.55 2.15v2.7h1.9c1.05 0 1.7-.55 1.7-1.35s-.65-1.35-1.7-1.35h-1.9z"/></svg>';
const GAUGE_ICO = '<svg class="ico" viewBox="0 0 24 24" fill="none" stroke="#f0b040" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M4.6 17.4a8.6 8.6 0 1 1 14.8 0"/><path d="M12 17.4 16.1 9.7"/><circle cx="12" cy="17.4" r="1.55" fill="#f0b040" stroke="none"/></svg>';
const MAP_ICO = '<svg class="mico" viewBox="0 0 24 24" width="20" height="20" aria-hidden="true"><g fill="none" stroke="currentColor" stroke-width="2" stroke-linejoin="round" stroke-linecap="round"><path d="M9 4 3 6.5v13L9 17l6 2.5 6-2.5V4l-6 2.5z"/><path d="M9 4v13M15 6.5v13"/></g></svg>';
const FEAT_ICO = '<svg class="feico" viewBox="0 0 24 24" width="20" height="20" aria-hidden="true"><g fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M5 20V11M12 20V5M19 20v-6"/></g></svg>';
const CHEV = '<svg class="chev" viewBox="0 0 24 24" width="22" height="22" aria-hidden="true"><path d="m6 9 6 6 6-6" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"/></svg>';

const ICO = {
  driving: '<path d="M5 16.5 6.8 11h8.4L18 16.5M5 16.5h13.5M7.2 16.5a1.6 1.6 0 1 0 0 0.01M16.2 16.5a1.6 1.6 0 1 0 0 0.01M8 11l.8-2.4h5.2L15 11"/>',
  climate: '<path d="M10 4.8h4v8.2a3.4 3.4 0 1 1-4 0z"/><path d="M10.2 7.2h2.3M10.2 9.4h2.3"/>',
  batt: '<rect x="4" y="8" width="14" height="10" rx="1.8"/><path d="M18 11.2V14.8h1.6c.6 0 .9-.3.9-.8v-2c0-.5-.3-.8-.9-.8zM9.2 11.2v3.6M12 11.2v3.6M14.8 11.2v3.6"/>',
  elevation: '<path d="m4 16 5.2-8 3.4 5.2L16.2 9 20 16z"/>',
  other: '<circle cx="7" cy="12" r="1.3"/><circle cx="12" cy="12" r="1.3"/><circle cx="17" cy="12" r="1.3"/>',
  sentry: '<path d="M4.8 9.2 12 5.5l7.2 3.7v4.4c0 3.6-2.8 5.7-7.2 7-4.4-1.3-7.2-3.4-7.2-7z"/><circle cx="12" cy="12.2" r="2.2"/>',
  cop: '<circle cx="12" cy="12" r="3.2"/><path d="M12 5.2v1.6M12 17.2v1.6M5.2 12h1.6M17.2 12h1.6M7.2 7.2l1.1 1.1M15.7 15.7l1.1 1.1M16.8 7.2l-1.1 1.1M8.3 15.7l-1.1 1.1"/>',
  precond: '<path d="M16.4 8A6 6 0 1 0 18 12.2"/><path d="M16.4 5.4v2.8h2.8"/>',
  outlets: '<path d="M8 8.5V4.8M16 8.5V4.8M6.5 8.5h11v4.2A5.5 5.5 0 0 1 12 18.2 5.5 5.5 0 0 1 6.5 12.7zM12 18.2V21"/>',
  screen: '<rect x="3.5" y="5.5" width="17" height="12" rx="2"/><path d="M8 20h8"/>',
  app: '<rect x="7" y="3.5" width="10" height="17" rx="2"/><path d="M11 18h2"/>',
  standby: '<path d="M12 3.5v8"/><path d="M7.3 5.8a7 7 0 1 0 9.4 0"/>',
};
const FEAT_LABEL = {
  driving: 'Driving', climate: 'Climate', batt: 'Battery Conditioning',
  elevation: 'Elevation', other: 'Everything Else',
  sentry: 'Sentry Mode', cop: 'Cabin Overheat Protection', precond: 'Preconditioning',
  outlets: 'Outlets', screen: 'Screen Time', app: 'Mobile App', standby: 'Vehicle Standby',
};
const TRIP_FEATS = [['driving', 80], ['climate', 8], ['batt', 12], ['elevation', -2], ['other', 2]];
const PARK_FEATS = [['sentry', 55], ['cop', 0], ['precond', 15], ['outlets', 0], ['screen', 2], ['app', 1], ['standby', 27]];
const PERIOD_TRIP_FEATS = [['driving', 78], ['climate', 9], ['batt', 11], ['elevation', 0], ['other', 2]];

function ico(id) {
  return `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${ICO[id] || ICO.other}</svg>`;
}
function exampleSplit(total, specs) {
  if (total == null) return [];
  const out = [];
  let used = 0;
  specs.forEach(([id, pct], i) => {
    let kwh;
    if (i === specs.length - 1) kwh = Math.round((total - used) * 100) / 100;
    else { kwh = Math.round(total * pct / 100 * 100) / 100; used += kwh; }
    out.push({ id, kwh, pct });
  });
  return out;
}

function setModeClass() {
  const el = $('#mode');
  if (!el) return;
  el.classList.toggle('saving', S.mode === 'saving');
  el.classList.toggle('energy', S.mode === 'energy');
  el.querySelector('.msave').classList.toggle('on', S.mode === 'saving');
  el.querySelector('.menergy').classList.toggle('on', S.mode === 'energy');
  el.querySelector('.msave').setAttribute('aria-selected', S.mode === 'saving' ? 'true' : 'false');
  el.querySelector('.menergy').setAttribute('aria-selected', S.mode === 'energy' ? 'true' : 'false');
}

function val(n, unit) {
  if (n == null || n === '–') return '–';
  const u = unit ? `<small>${esc(unit)}</small>` : '';
  return `${n}${u}`;
}
function kwhVal(v) {
  if (v == null) return '–';
  return val(fmtCom(v, v >= 1000 ? 0 : 1), 'kWh');
}

function renderSummary() {
  const [a, b] = periodRange();
  const keys = rangeKeys(a, b);
  const t = sumDays(keys);
  const en = energySum(keys);
  const whmi = t.mi ? Math.round(t.kwh * 1000 / t.mi) : null;
  let tiles;
  if (!energyMode()) {
    const mi = t.mi >= 1000 ? fmtCom(t.mi, 0) : fmtCom(t.mi, 1);
    tiles = [
      { k: `${WHEEL} Miles`, v: val(mi, 'mi'), cls: '' },
      { k: `${BOLT_ICO} Electric Cost`, v: val(money(t.elec)), cls: '' },
      { k: `${PUMP_ICO} Gas Cost`, v: val(money(t.gas)), cls: '' },
      { k: `${DBADGE} Saved`, v: val(money(t.save)), cls: 'hi-save' },
    ];
  } else {
    tiles = [
      { k: `${BOLT_ICO} Energy`, v: kwhVal(en.total), cls: '' },
      { k: `${WHEEL} Driving`, v: kwhVal(en.driving), cls: '' },
      { k: `${PARK_ICO} Parked`, v: en.known ? kwhVal(en.parked) : 'n/a', cls: '' },
      { k: `${GAUGE_ICO} Efficiency`, v: whmi != null ? val(whmi, 'Wh/mi') : '–', cls: 'hi-eff' },
    ];
  }
  $('#summary').innerHTML = tiles.map(x =>
    `<div class="stat ${x.cls}"><div class="k">${x.k}</div><div class="v">${x.v}</div></div>`
  ).join('');
}

function featureRows(feats, tone) {
  return (feats || []).map(f => {
    const name = FEAT_LABEL[f.id] || f.id;
    const zero = !f.kwh;
    const neg = f.kwh < 0;
    const width = Math.min(100, Math.abs(f.pct));
    const kwh = `${neg ? '−' : ''}${fmtKwh(Math.abs(f.kwh))}<small>kWh</small>`;
    const pct = `${neg ? '−' : ''}${Math.abs(f.pct)}%`;
    return `<div class="feat ${tone}${zero ? ' zero' : ''}${neg ? ' neg' : ''}">
      <span class="fico">${ico(f.id)}</span>
      <div class="fn">${esc(name)}</div>
      <div class="fk">${kwh}</div>
      <div class="fbar" aria-hidden="true"><i class="${neg ? 'neg' : ''}" style="width:${width}%"></i></div>
      <div class="fp">${pct}</div>
    </div>`;
  }).join('');
}
function featureBox(id, feats, tone) {
  if (!feats || !feats.length) return '';
  const open = OPEN.has(id);
  return `<div class="fbox${open ? ' open' : ''}" data-id="${esc(id)}">
    <button type="button" class="fhd" aria-expanded="${open ? 'true' : 'false'}">
      ${FEAT_ICO}<span class="fl">Feature energy usage</span>${CHEV}
    </button>
    <div class="fbody">
      <div class="exnote">Example numbers, not from the truck</div>
      ${featureRows(feats, tone)}
    </div>
  </div>`;
}
function periodFeatureBox(id, driving, parked, parkedNote) {
  const open = OPEN.has(id);
  return `<div class="fbox${open ? ' open' : ''}" data-id="${esc(id)}">
    <button type="button" class="fhd" aria-expanded="${open ? 'true' : 'false'}">
      ${FEAT_ICO}<span class="fl">Feature energy usage</span>${CHEV}
    </button>
    <div class="fbody">
      <div class="exnote">Example numbers, not from the truck</div>
      <div class="exsec">While driving</div>
      ${featureRows(exampleSplit(driving, PERIOD_TRIP_FEATS), 'trip')}
      <div class="exsec">While parked${parkedNote ? ` · ${esc(parkedNote)}` : ''}</div>
      ${featureRows(exampleSplit(parked || 0, PARK_FEATS), 'parked')}
    </div>
  </div>`;
}

function fsdRow(t) {
  if (!t.fsd) return '';
  return `<div class="fsdbar"><span>FSD</span><div class="fb"><div style="width:${t.fsd.pct}%"></div></div><b>${t.fsd.pct}%</b><span class="of">${num(t.fsd.mi, 0)} of ${num(t.mi, 0)} mi</span></div>`;
}
function routeBox(t) {
  const hasMap = (t.route && t.route.length > 1) || (t.gps && t.gps.length > 1);
  if (!hasMap) return '';
  return `<div class="routebox"><button type="button" class="maptoggle" aria-expanded="false">${MAP_ICO}<span class="ml">Show route &amp; playback</span>${CHEV}</button><div class="rbody"><div class="rinner"><div class="map" id="map-${t.id}"></div></div></div></div>`;
}
function costRow(t) {
  return `<div class="cost">
    <div class="row">
      <span>${BOLT_ICO} ${money(t.elec)}${t.cest ? '<span class="tag"> est</span>' : ''}</span>
      <span class="pump">${PUMP_ICO} ${money(t.gas)}</span>
      <span class="g">${DBADGE} ${money(t.save)}<span class="sv">saved</span></span>
    </div>
    <div class="cap ratecap">${t.rate ? '$' + t.rate.toFixed(3) + '/kWh' : ''} · premium ${t.gp ? '$' + t.gp.toFixed(2) + '/gal' : ''} ${esc(t.garea || '')} · ${S.meta.mpg} mpg</div>
  </div>`;
}
function statBoxes(cells) {
  return `<div class="tg">${cells.map(c => `<div><b>${c.v}</b><span>${esc(c.k)}</span></div>`).join('')}</div>`;
}
function batLabel(a, b) {
  const ok = v => v != null && v !== '' && !isNaN(+v);
  if (!ok(a) && !ok(b)) return '–';
  const ri = v => ok(v) ? String(Math.round(+v)) : '–';
  return `${ri(a)}% → ${ri(b)}%`;
}

function tripCard(t, idx, total) {
  TRIPS[t.id] = t;
  const n = idx + 1;
  const dur = (t.min != null ? t.min + ' min' : fmtSpan(t.s, t.e));
  const right = energyMode()
    ? `<span>${esc(dur)}</span><span>${t.mi >= 10 ? num(t.mi, 1) : num(t.mi, 2)} mi</span>`
    : `<span>${esc(dur)}</span>`;
  const when = `${timeTs(t.s)}${t.est ? '<span class="tag"> ~start</span>' : ''} – ${timeTs(t.e)}`;
  const featId = 'trip-' + t.id;
  return `<div class="card trip" data-trip="${t.id}">
    <div class="hd">
      <span class="badge trip">${WHEEL} Trip ${n}/${total}</span>
      <span class="when">${when}</span>
      <span class="right">${right}</span>
    </div>
    <div class="rt"><div>${esc(t.from)}</div><div>${esc(t.to)}</div></div>
    ${statBoxes([
      { v: num(t.mi, 2), k: 'mi' },
      { v: batLabel(t.soc0, t.soc1), k: 'battery' },
      { v: num(t.kwh, 2), k: 'kWh' },
      { v: t.whmi ?? '–', k: 'Wh/mi' },
    ])}
    ${energyMode() ? '' : costRow(t)}
    ${energyMode() ? '' : fsdRow(t)}
    ${energyMode() ? featureBox(featId, exampleSplit(t.kwh || 0, TRIP_FEATS), 'trip') : ''}
    ${energyMode() ? '' : routeBox(t)}
  </div>`;
}

function chargeInfoLine(it) {
  const bits = [];
  if (it.volts && it.amps != null) bits.push(`${Math.round(it.volts)} V · ${it.amps} A`);
  else if (it.volts) bits.push(`${Math.round(it.volts)} V`);
  else if (it.amps != null) bits.push(`${it.amps} A`);
  if (it.cost != null) bits.push(money(it.cost));
  if (it.mi != null && it.mi > 0) bits.push('+' + num(it.mi, it.mi >= 10 ? 0 : 1) + ' mi');
  return bits.join(' · ');
}
function chargeCard(it) {
  const ongoing = !!it.open;
  const when = `${timeTs(it.s)} – ${ongoing ? 'now' : timeTs(it.e)}`;
  const dur = fmtSpan(it.s, it.e);
  const added = it.added != null ? it.added : it.kwh;
  const kw = it.kw != null ? num(it.kw, 2) : '–';
  const label = it.label || it.where || 'Charger';
  const info = chargeInfoLine(it);
  const right = ongoing
    ? `<span>${esc(dur)}</span><span>Charging</span>`
    : `<span>${esc(dur)}</span>`;
  return `<div class="card charge${ongoing ? ' live' : ''}">
    <div class="hd">
      <span class="badge chg">${PLUG_ICO} Charging</span>
      <span class="when">${esc(when)}</span>
      <span class="right">${right}</span>
    </div>
    <div class="where">${esc(label)}${info ? `<span class="chinfo"> · ${esc(info)}</span>` : ''}</div>
    ${statBoxes([
      { v: added != null ? '+' + num(added, added >= 10 ? 1 : 2) : '–', k: 'kWh' },
      { v: batLabel(it.soc0, it.soc1), k: 'battery' },
      { v: kw, k: 'kW' },
      { v: esc(dur), k: 'duration' },
    ])}
  </div>`;
}

function parkedCard(it) {
  const when = `${timeTs(it.s)} – ${timeTs(it.e)}`;
  const dur = fmtSpan(it.s, it.e);
  const featId = 'parked-' + it.s;
  return `<div class="card parked">
    <div class="hd">
      <span class="badge park">Parked</span>
      <span class="when">${esc(when)}</span>
      <span class="right"><span>${esc(dur)}</span></span>
    </div>
    ${statBoxes([
      { v: num(it.kwh, 2), k: 'kWh' },
      { v: batLabel(it.soc0, it.soc1), k: 'battery' },
      { v: it.w != null ? fmtW(it.w) : '–', k: 'W' },
      { v: it.kwh_day != null ? num(it.kwh_day, 1) : '–', k: 'kWh/day' },
    ])}
    ${energyMode() ? featureBox(featId, exampleSplit(it.kwh || 0, PARK_FEATS), 'parked') : ''}
  </div>`;
}

function setTitle() {
  const c = S.cur; let t;
  if (S.view === 'day') t = c.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric', year: 'numeric' });
  else if (S.view === 'week') { const s = weekStart(c), e = addDays(s, 6); t = `${s.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })} – ${e.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}`; }
  else if (S.view === 'month') t = `${MONTHS[c.getMonth()]} ${c.getFullYear()}`;
  else t = String(c.getFullYear());
  $('#title').textContent = t;
  document.querySelectorAll('#seg button').forEach(b => b.classList.toggle('on', b.dataset.v === S.view));
  setModeClass();
}

function viewMonthSaving() {
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

function viewWeekSaving() {
  const s = weekStart(S.cur); let h = '', mx = 0;
  for (let i = 0; i < 7; i++) mx = Math.max(mx, (S.meta.days[keyOf(addDays(s, i))] || {}).mi || 0);
  for (let i = 0; i < 7; i++) {
    const d = addDays(s, i), k = keyOf(d), x = S.meta.days[k] || {}, dc = `<div class="d"><span>${DOW[d.getDay()]}</span><b>${d.getDate()}</b></div>`;
    if (!x.n) { h += `<div class="row wrow nod" data-day="${k}">${dc}<div class="wm"><span class="none">No drives</span></div></div>`; continue; }
    const pct = x.fsdk ? Math.min(100, Math.round(100 * (x.fsd || 0) / x.fsdk)) : null, part = x.fsdk && x.fsdk < (x.mi || 0) - 0.05;
    const w = mx ? Math.max(0.15, (x.mi || 0) / mx) : 1;
    h += `<div class="row wrow" data-day="${k}">${dc}
    <div class="wm" style="--w:${w.toFixed(3)}"><span class="fl">FSD</span><div class="wtk"><div class="fb"><div style="width:${pct ?? 0}%"></div></div><b>${pct == null ? '–' : (part ? '~' : '') + pct + '%'}</b></div>
    <div class="wl"><span>${x.n} trip${x.n === 1 ? '' : 's'}</span><span>${num(x.mi || 0, 1)} mi</span></div></div>
    <div class="wc"><span>${BOLT_ICO} ${money(x.elec || 0)}</span><span class="pump">${PUMP_ICO} ${money(x.gas || 0)}</span><span class="g">${DBADGE} ${money(x.save || 0)}<span class="sv">saved</span></span></div></div>`;
  }
  return h;
}

function viewYearSaving() {
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

function periodNote(kind, keys, en) {
  const from = S.meta.energy_from;
  const bits = [];
  if (from) bits.push(`Parked drain starts ${fmtMd(from)}${kind === 'week' ? ', when telemetry began' : ''}.`);
  if (kind === 'week' || kind === 'month') {
    const na = keys.filter(k => {
      const d = S.meta.days[k];
      return d && d.n && !(d.parked_known);
    });
    if (na.length) {
      const names = na.map(k => {
        const [y, m, d] = k.split('-').map(Number);
        return new Date(y, m - 1, d).toLocaleDateString('en-US', { weekday: kind === 'week' ? 'short' : 'month', day: kind === 'month' ? 'numeric' : undefined });
      });
      bits.push(kind === 'week' ? `${names.join(' and ')} are driving only.` : `Earlier days show driving only.`);
    }
  }
  const today = keyOf(todayD());
  if (keys.includes(today)) {
    const d = S.meta.days[today] || {};
    const tot = (d.kwh || 0) + (d.parked_known ? (d.parked || 0) : 0);
    if (!d.n && d.parked_known && tot === 0 && (d.charge_added || 0) > 0) {
      const name = todayD().toLocaleDateString('en-US', { weekday: 'long' });
      bits.push(`${name} is today — charging, no use so far.`);
    }
  }
  if (kind === 'month') {
    const last = keys[keys.length - 1];
    const future = keys.filter(k => k > today);
    if (future.length) {
      const a = fmtMd(future[0]), b = fmtMd(future[future.length - 1]);
      bits.push(`${a}–${b.replace(/^[A-Za-z]+ /, '')} have no data yet.`);
    }
    void last;
  }
  if (kind === 'year') {
    const days = Object.keys(S.meta.days || {}).filter(k => k.startsWith(String(S.cur.getFullYear()))).sort();
    if (days.length) bits.unshift(`Trip data starts ${fmtMd(days[0])}.`);
    if (from && from.slice(0, 4) === String(S.cur.getFullYear())) {
      const before = [];
      for (let m = 0; m < 12; m++) {
        const ym = `${S.cur.getFullYear()}-${pad(m + 1)}`;
        const start = `${ym}-01`;
        if (start < from) {
          const has = days.some(k => k.startsWith(ym) && (S.meta.days[k] || {}).n);
          if (has) before.push(MONTHS[m]);
        }
      }
      if (before.length) bits.push(`So ${before.join(' and ')} ${before.length === 1 ? 'is' : 'are'} driving only.`);
    }
  }
  return bits.join(' ');
}


function dayStartTs(key) {
  const [y, m, d] = key.split('-').map(Number);
  return new Date(y, m - 1, d).getTime() / 1000;
}
function monthRecsForTs(ts) {
  const recs = [];
  const seen = new Set();
  const d = new Date(ts * 1000);
  for (const off of [-1, 0, 1]) {
    const x = new Date(d); x.setDate(x.getDate() + off);
    const ym = `${x.getFullYear()}-${pad(x.getMonth() + 1)}`;
    if (seen.has(ym)) continue;
    seen.add(ym);
    if (S.months[ym]) recs.push(S.months[ym]);
  }
  return recs;
}
function socAtMidnight(ts) {
  const tol = 2;
  let found = null;
  for (const rec of monthRecsForTs(ts)) {
    for (const sl of rec.charge_slices || []) {
      if (Math.abs((sl.e || 0) - ts) <= tol && sl.soc1 != null) found = sl.soc1;
      if (Math.abs((sl.s || 0) - ts) <= tol && sl.soc0 != null) found = sl.soc0;
    }
    for (const p of rec.parked || []) {
      if (Math.abs((p.e || 0) - ts) <= tol && p.soc1 != null) found = p.soc1;
      if (Math.abs((p.s || 0) - ts) <= tol && p.soc0 != null) found = p.soc0;
    }
  }
  return found;
}
function socPctLabel(v) {
  return v == null || v === '' || isNaN(+v) ? 'n/a' : Math.round(+v) + '%';
}
async function ensureMonthsForKeys(keys) {
  const yms = new Set(keys.map(k => k.slice(0, 7)));
  for (const k of [keys[0], keys[keys.length - 1]]) {
    if (!k) continue;
    const [y, m, d] = k.split('-').map(Number);
    yms.add(keyOf(addDays(new Date(y, m - 1, d), -1)).slice(0, 7));
    yms.add(keyOf(addDays(new Date(y, m - 1, d), 1)).slice(0, 7));
  }
  for (const ym of yms) await month(ym);
}
function energyUseRow({ labelHtml, dataAttr, driving, parked, known, parked_w, charge, soc0, soc1, mx }) {
  const tot = known ? driving + (parked || 0) : driving;
  const w = mx ? tot / mx : 0;
  const drvPct = tot ? (100 * driving / tot) : 0;
  const parkPct = known && tot ? (100 * (parked || 0) / tot) : 0;
  const chgW = (charge > 0 && mx) ? Math.min(1, charge / mx) : 0;
  const capped = charge > 0 && mx && charge > mx + 0.05;
  const kwhDec = tot >= 100 ? 0 : 1;
  const label = known ? fmtCom(tot, kwhDec) : fmtCom(driving, kwhDec);
  const segs = `<i class="ed" style="width:${drvPct}%"></i>`
    + (known && parkPct ? `<i class="ep" style="width:${parkPct}%"></i>` : '');
  const chgBar = chgW ? `<div class="echg${capped ? ' cap' : ''}" style="--cw:${chgW.toFixed(3)}" title="${capped ? 'Charging exceeds this scale' : ''}"></div>` : '';
  const dDec = driving >= 100 ? 0 : 1;
  const pDec = (parked || 0) >= 100 ? 0 : 1;
  const cDec = charge >= 100 ? 0 : 1;
  const bits = [`<span class="ei drv">${WHEEL} ${fmtCom(driving, dDec)}</span>`];
  if (known) {
    const wBit = parked_w ? ` <span class="w">${fmtW(parked_w)} W</span>` : '';
    bits.push(`<span class="ei park">${PARK_ICO} ${fmtCom(parked || 0, pDec)}${wBit}</span>`);
  } else {
    bits.push(`<span class="ei park mute">${PARK_ICO} n/a</span>`);
  }
  if (charge) bits.push(`<span class="ei chg">${PLUG_ICO} +${fmtCom(charge, cDec)}</span>`);
  return `<div class="ewk" ${dataAttr || ''}>
    ${labelHtml}
    <div class="em" style="--w:${Math.max(0, w).toFixed(3)}">
      <div class="etk">
        <span class="ebat">${socPctLabel(soc0)}</span>
        <div class="ebars">
          <div class="etrack"><div class="estk">${segs}</div></div>
          ${chgBar}
        </div>
        <span class="ebat end">${socPctLabel(soc1)}</span>
        <b class="et">${label}</b>
      </div>
      <div class="ecap">${bits.join('')}</div>
    </div>
  </div>`;
}

async function viewWeekEnergy() {
  const s = weekStart(S.cur);
  const keys = rangeKeys(s, addDays(s, 6));
  await ensureMonthsForKeys(keys);
  const en = energySum(keys);
  let mx = 0;
  const days = keys.map(k => {
    const dt = new Date(+k.slice(0, 4), +k.slice(5, 7) - 1, +k.slice(8, 10));
    const x = S.meta.days[k] || {};
    const known = !!x.parked_known;
    const driving = x.kwh || 0;
    const parked = known ? (x.parked || 0) : null;
    const tot = known ? driving + (parked || 0) : driving;
    if (tot) mx = Math.max(mx, tot);
    const t0 = dayStartTs(k);
    const t1 = dayStartTs(keyOf(addDays(dt, 1)));
    return { k, dt, x, known, driving, parked, tot, charge: x.charge_added || 0, soc0: socAtMidnight(t0), soc1: socAtMidnight(t1) };
  });
  if (!mx) mx = 1;
  const rows = days.map(d => {
    const dc = `<div class="d"><span>${DOW[d.dt.getDay()]}</span><b>${d.dt.getDate()}</b></div>`;
    const emptyChg = !d.x.n && d.known && d.tot === 0 && d.charge > 0;
    if (emptyChg) {
      return `<div class="ewk nod" data-day="${d.k}">${dc}<div class="em"><span class="none chg-note">${PLUG_ICO} Charging · no use so far</span></div></div>`;
    }
    if (!d.x.n && d.tot === 0 && !d.charge) {
      return `<div class="ewk nod" data-day="${d.k}">${dc}<div class="em"><span class="none">No use</span></div></div>`;
    }
    return energyUseRow({
      labelHtml: dc,
      dataAttr: `data-day="${d.k}"`,
      driving: d.driving, parked: d.parked, known: d.known,
      parked_w: d.x.parked_w, charge: d.charge,
      soc0: d.soc0, soc1: d.soc1, mx,
    });
  }).join('');
  const from = fmtMd(S.meta.energy_from);
  const note = periodNote('week', keys, en);
  return `<div class="pcard">
    ${note ? `<div class="cap enote">${esc(note)}</div>` : ''}
    <div class="elist period">${rows}</div>
    ${periodFeatureBox('week-feat', en.driving, en.parked, from ? 'from ' + from + ' only' : '')}
  </div>`;
}

function viewMonthEnergy() {
  const c = S.cur, first = new Date(c.getFullYear(), c.getMonth(), 1), last = new Date(c.getFullYear(), c.getMonth() + 1, 0);
  const start = weekStart(first), tk = keyOf(todayD());
  const monthKeys = rangeKeys(first, last);
  const en = energySum(monthKeys);
  let mx = 1;
  for (const k of monthKeys) {
    const x = S.meta.days[k] || {};
    const tot = x.parked_known ? (x.kwh || 0) + (x.parked || 0) : (x.kwh || 0);
    if (tot > mx) mx = tot;
  }
  const cells = [];
  for (let i = 0; i < 42; i++) {
    const d = addDays(start, i);
    if (i >= 35 && d.getMonth() !== c.getMonth()) break;
    const k = keyOf(d), inMon = d.getMonth() === c.getMonth();
    const x = S.meta.days[k] || {};
    const known = !!x.parked_known;
    const driving = x.kwh || 0;
    const parked = known ? (x.parked || 0) : 0;
    const tot = known ? driving + parked : driving;
    const future = k > tk;
    const empty = !inMon || future || (!x.n && !known && !(x.charge_added) && !driving);
    const chargeOnly = inMon && !x.n && known && !tot && (x.charge_added || 0) > 0;
    const cls = ['mcol'];
    if (k === tk && inMon) cls.push('today');
    if (!inMon || future) cls.push('out');
    else if (empty || chargeOnly) cls.push('nod');
    let bar = '', val = '';
    if (inMon && !future && !empty && !chargeOnly) {
      const h = Math.max(12, Math.round(100 * tot / mx));
      const drvPct = tot ? (100 * driving / tot) : 0;
      const parkPct = known && tot && parked ? (100 - drvPct) : 0;
      bar = `<div class="bstk" style="height:${h}%"><i class="ed" style="flex:${known ? drvPct : 1} 0 0"></i>${parkPct ? `<i class="ep" style="flex:${parkPct} 0 0"></i>` : ''}</div>`;
      val = known ? fmtCom(tot, tot >= 10 ? 0 : 1) : fmtCom(driving, driving >= 10 ? 0 : 1);
    }
    const dayAttr = inMon ? ` data-day="${k}"` : '';
    cells.push(`<div class="${cls.join(' ')}"${dayAttr}><div class="bh">${bar}</div><div class="n">${d.getDate()}</div><div class="v">${val}</div></div>`);
  }
  const avgs = [];
  const drivenDays = monthKeys.filter(k => (S.meta.days[k] || {}).n).length;
  const parkedDays = monthKeys.filter(k => (S.meta.days[k] || {}).parked_known);
  if (drivenDays) avgs.push(`<span>Avg <b>${fmtCom(en.driving / drivenDays, 1)} kWh</b>/day driven</span>`);
  if (parkedDays.length && en.known) avgs.push(`<span><b>${fmtCom(en.parked / parkedDays.length, 1)} kWh</b>/day parked since ${esc(fmtMd(S.meta.energy_from))}</span>`);
  if (en.whmi) avgs.push(`<span><b>${en.whmi} Wh/mi</b></span>`);
  const from = fmtMd(S.meta.energy_from);
  const note = periodNote('month', monthKeys, en);
  return `<div class="pcard">
    ${note ? `<div class="cap enote">${esc(note)}</div>` : ''}
    <div class="avgs">${avgs.join('')}</div>
    <div class="mhead">${['S','M','T','W','T','F','S'].map(x => `<div>${x}</div>`).join('')}</div>
    <div class="mchart">${cells.join('')}</div>
    ${periodFeatureBox('month-feat', en.driving, en.parked, from ? 'from ' + from + ' only' : '')}
  </div>`;
}

async function viewYearEnergy() {
  const y = S.cur.getFullYear();
  const yearKeys = rangeKeys(new Date(y, 0, 1), new Date(y, 11, 31));
  await ensureMonthsForKeys(yearKeys);
  const en = energySum(yearKeys);
  let mx = 1;
  const months = [];
  for (let m = 0; m < 12; m++) {
    const first = new Date(y, m, 1), last = new Date(y, m + 1, 0);
    const keys = rangeKeys(first, last);
    const e = energySum(keys);
    const t = sumDays(keys);
    const has = t.n > 0 || e.driving > 0 || (e.known && e.parked > 0) || (e.charge_added || 0) > 0;
    if (has) mx = Math.max(mx, e.total || e.driving || 0);
    const soc0 = socAtMidnight(first.getTime() / 1000);
    const next = new Date(y, m + 1, 1);
    const soc1 = socAtMidnight(next.getTime() / 1000);
    months.push({ m, first, last, keys, e, t, has, soc0, soc1 });
  }
  const rows = months.map(mo => {
    const dc = `<div class="d" style="text-align:left;width:auto"><b style="font-size:16px">${MONTHS[mo.m].slice(0, 3)}</b></div>`;
    if (!mo.has) {
      return `<div class="ewk nod" data-month="${mo.m}">${dc}<div class="em"><span class="none">No data</span></div></div>`;
    }
    return energyUseRow({
      labelHtml: dc,
      dataAttr: `data-month="${mo.m}"`,
      driving: mo.e.driving, parked: mo.e.parked, known: mo.e.known,
      parked_w: mo.e.parked_w, charge: mo.e.charge_added || 0,
      soc0: mo.soc0, soc1: mo.soc1, mx,
    });
  }).join('');
  const from = fmtMd(S.meta.energy_from);
  const note = periodNote('year', yearKeys, en);
  return `<div class="pcard">
    ${note ? `<div class="cap enote">${esc(note)}</div>` : ''}
    <div class="elist period">${rows}</div>
    ${periodFeatureBox('year-feat', en.driving, en.parked, from ? 'from ' + from + ' only' : '')}
  </div>`;
}

function viewWeek() { return energyMode() ? viewWeekEnergy() : viewWeekSaving(); }
function viewMonth() { return energyMode() ? viewMonthEnergy() : viewMonthSaving(); }
function viewYear() { return energyMode() ? viewYearEnergy() : viewYearSaving(); }

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
  const trips = (m.trips || []).filter(t => dayKeyTs(t.s) === k).sort((a, b) => a.s - b.s);
  if (!energyMode()) {
    return trips.length ? trips.map((t, i) => tripCard(t, i, trips.length)).join('') : '<div class="empty">No trips this day</div>';
  }
  const t0 = S.cur, start = Date.UTC(t0.getFullYear(), t0.getMonth(), t0.getDate());
  // Use payload timestamps in local day via dayKeyTs / overlap with the local day
  const parked = (m.parked || []).filter(p => dayKeyTs(p.s) === k || dayKeyTs(p.e - 1) === k)
    .filter(p => (p.kwh || 0) > 0.005)
    .sort((a, b) => a.s - b.s);
  const slices = (m.charge_slices || []).filter(c => dayKeyTs(c.s) === k || (c.e > c.s && dayKeyTs(c.e - 1) === k))
    .sort((a, b) => a.s - b.s);
  const items = [
    ...trips.map(t => ({ kind: 'trip', s: t.s, t })),
    ...slices.map(c => ({ kind: 'charge', s: c.s, c })),
    ...parked.map(p => ({ kind: 'parked', s: p.s, p })),
  ].sort((a, b) => a.s - b.s);
  if (!items.length) return '<div class="empty">No energy use this day</div>';
  let ti = 0;
  return items.map(it => {
    if (it.kind === 'trip') return tripCard(it.t, ti++, trips.length);
    if (it.kind === 'charge') return chargeCard(it.c);
    return parkedCard(it.p);
  }).join('');
}

async function render() {
  stopPlayers();
  for (const k in MAPS) { try { MAPS[k].remove(); } catch (e) {} delete MAPS[k]; }
  localStorage.setItem('ht_view', S.view);
  localStorage.setItem('ht_mode', S.mode);
  setTitle(); renderSummary();
  const main = $('#main');
  try {
    main.innerHTML = S.view === 'day' ? await viewDay() : S.view === 'week' ? await viewWeek() : S.view === 'month' ? viewMonth() : await viewYear();
  } catch (e) { main.innerHTML = `<div class="empty">Couldn't load: ${esc(e.message)}</div>`; }
  const meta = S.meta, upd = new Date(meta.generated * 1000).toLocaleString('en-US', { timeZone: TZ, month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });
  $('#foot').innerHTML = `Updated ${upd} ET · DTE ${esc(meta.plan)} · premium $${(+meta.gas_home).toFixed(2)} · ${meta.mpg} mpg${meta.pending ? ` · <span class="tag">${meta.pending} charge price to confirm</span>` : ''}<br><a href="#" id="info">How costs are calculated</a> · <a href="#" id="lockout">Lock</a>`;
  $('#info').onclick = e => { e.preventDefault(); showInfo(); };
  $('#lockout').onclick = e => { e.preventDefault(); localStorage.removeItem('ht_key'); location.reload(); };
}

function showInfo() {
  const m = S.meta, r = m.home_rates || {};
  $('#sheetbody').innerHTML = `<h3 style="margin-top:0">How costs are calculated</h3>
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
  S.cur = c; OPEN.clear(); render();
}
function wire() {
  $('#prev').onclick = () => move(-1); $('#next').onclick = () => move(1);
  $('#today').onclick = () => { S.cur = todayD(); OPEN.clear(); render(); };
  document.querySelectorAll('#seg button').forEach(b => b.onclick = () => { S.view = b.dataset.v; OPEN.clear(); render(); });
  $('#mode').addEventListener('click', ev => {
    const btn = ev.target.closest('button[data-mode]');
    if (!btn || btn.dataset.mode === S.mode) return;
    S.mode = btn.dataset.mode === 'energy' ? 'energy' : 'saving';
    localStorage.setItem('ht_mode', S.mode);
    OPEN.clear();
    render();
  });
  $('#main').addEventListener('click', e => {
    const fh = e.target.closest('.fhd');
    if (fh) {
      const box = fh.closest('.fbox'), id = box && box.dataset.id;
      const open = box.classList.toggle('open');
      fh.setAttribute('aria-expanded', open ? 'true' : 'false');
      if (id) { if (open) OPEN.add(id); else OPEN.delete(id); }
      return;
    }
    const mt = e.target.closest('.maptoggle'); if (mt) { toggleMap(+mt.closest('.trip').dataset.trip); return; }
    const d = e.target.closest('[data-day]'), mo = e.target.closest('[data-month]');
    if (d) { const [y, mon, da] = d.dataset.day.split('-').map(Number); S.cur = new Date(y, mon - 1, da); S.view = 'day'; OPEN.clear(); render(); }
    else if (mo) { S.cur = new Date(S.cur.getFullYear(), +mo.dataset.month, 1); S.view = 'month'; OPEN.clear(); render(); }
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
