'use strict';
const TZ = 'America/Detroit';
const $ = s => document.querySelector(s);
const S = {
  view: localStorage.getItem('ht_view') || 'month',
  mode: (['energy','automation','report','control','daily'].includes(localStorage.getItem('ht_mode')) ? localStorage.getItem('ht_mode') : 'saving'),
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
  if (typeof afterTrackerUnlock === 'function') {
    try { await afterTrackerUnlock(pass); } catch (e) {}
  }
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
const ELEC_ICO = '<svg class="ico" viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="9" fill="none" stroke="#34c759" stroke-width="1.8"/><g transform="translate(12 12) scale(0.46) translate(-12 -12)"><path fill="#34c759" d="M13.2 2.5 5.8 13.2h5.3l-.8 8.3 8.2-12.2h-5.4z"/></g></svg>';
const PLUG_ICO = '<svg class="ico" viewBox="0 0 24 24" aria-hidden="true"><path fill="currentColor" d="M3.2 10.15h6.6c.4 0 .7.3.7.7v2.3c0 .4-.3.7-.7.7H3.2c-.7 0-1.2-.5-1.2-1.15v-1.4c0-.65.5-1.15 1.2-1.15z"/><rect x="9.4" y="7.6" width="7" height="8.8" rx="1.8" fill="currentColor"/><rect x="16.2" y="9.15" width="4.6" height="1.7" rx=".7" fill="currentColor"/><rect x="16.2" y="13.15" width="4.6" height="1.7" rx=".7" fill="currentColor"/></svg>';
const PUMP_ICO = '<svg class="ico gasico" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="3.8" y="3.5" width="9.2" height="16.5" rx="1.4"/><path d="M7 8h3.2M13 8.2h2.4c1.15 0 2.2.95 2.2 2.15V15"/><circle cx="17.6" cy="16.4" r="1.55" fill="currentColor" stroke="none"/></svg>';
const PARK_ICO = '<svg class="ico" viewBox="0 0 24 24" aria-hidden="true"><rect x="3.2" y="3.2" width="17.6" height="17.6" rx="4.2" fill="#f0b040"/><path fill="#1a1408" d="M8.55 6.55h4.7c2.35 0 3.85 1.35 3.85 3.5 0 2.15-1.55 3.55-3.85 3.55h-2.1V17.45H8.55V6.55zm2.55 2.15v2.7h1.9c1.05 0 1.7-.55 1.7-1.35s-.65-1.35-1.7-1.35h-1.9z"/></svg>';
const GAUGE_ICO = '<svg class="ico" viewBox="0 0 24 24" fill="none" stroke="#f0b040" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M4.6 17.4a8.6 8.6 0 1 1 14.8 0"/><path d="M12 17.4 16.1 9.7"/><circle cx="12" cy="17.4" r="1.55" fill="#f0b040" stroke="none"/></svg>';
const MAP_ICO = '<svg class="mico" viewBox="0 0 24 24" width="20" height="20" aria-hidden="true"><g fill="none" stroke="currentColor" stroke-width="2" stroke-linejoin="round" stroke-linecap="round"><path d="M9 4 3 6.5v13L9 17l6 2.5 6-2.5V4l-6 2.5z"/><path d="M9 4v13M15 6.5v13"/></g></svg>';
const FEAT_ICO = '<svg class="feico" viewBox="0 0 24 24" width="20" height="20" aria-hidden="true"><g fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M5 20V11M12 20V5M19 20v-6"/></g></svg>';
const BAT_STAT_ICO = '<svg class="batico" viewBox="0 0 16 24" aria-hidden="true"><rect x="5.1" y="1.1" width="5.8" height="2.4" rx=".8" fill="currentColor"/><rect x="2.2" y="3.4" width="11.6" height="19.3" rx="2.3" fill="none" stroke="currentColor" stroke-width="1.8"/></svg>';
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
  const auto = S.mode === 'automation';
  const report = S.mode === 'report';
  const control = S.mode === 'control';
  const app = $('#app');
  if (app) {
    app.classList.toggle('mode-auto', auto);
    app.classList.toggle('mode-report', report);
    app.classList.toggle('mode-control', control);
    app.classList.toggle('rpt-arch', !!(report && window.REPORT && REPORT.archive));
  }
  const rhead = $('#reporthead');
  if (rhead) rhead.classList.toggle('hidden', !report);
  const srcrow = $('#rptsrcrow');
  if (srcrow && !report) {
    srcrow.hidden = true;
    srcrow.classList.add('hidden');
  }
  const head = $('#autohead');
  if (head) {
    head.classList.toggle('hidden', !auto);
    const editing = auto && (AUTO.editing != null || AUTO.view !== 'list');
    head.classList.toggle('is-edit', !!editing);
    const back = $('#autoback');
    if (back) back.classList.toggle('hidden', !editing);
    const title = $('#autotitle');
    if (title) title.textContent = auto ? autoTitle() : 'Automations';
  }
  if (typeof setControlChrome === 'function') setControlChrome();
  if (typeof setDailyChrome === 'function') setDailyChrome();
  document.querySelectorAll('#tabbar button').forEach(b => {
    const on = b.dataset.mode === S.mode;
    b.classList.toggle('on', on);
    b.setAttribute('aria-selected', on ? 'true' : 'false');
  });
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


const EPA_WHMI = 430;

function daysWhmi(keys) {
  let kwh = 0, mi = 0;
  for (const k of keys) {
    const d = S.meta.days[k]; if (!d) continue;
    kwh += d.kwh || 0;
    mi += d.mi || 0;
  }
  return mi ? Math.round(kwh * 1000 / mi) : null;
}
function priorKeysBefore(startKey, nDays) {
  const [y, m, d] = startKey.split('-').map(Number);
  const start = new Date(y, m - 1, d);
  const keys = [];
  for (let i = nDays; i >= 1; i--) keys.push(keyOf(addDays(start, -i)));
  return keys;
}
function periodBaseline(keys) {
  if (!keys || !keys.length) return null;
  let base = daysWhmi(priorKeysBefore(keys[0], 30));
  if (base != null) return base;
  const from = S.meta.energy_from || '2026-09-09';
  const all = Object.keys(S.meta.days || {}).filter(k => k >= from && k < keys[0]).sort();
  return daysWhmi(all);
}
function rateEff(whmi, baseline) {
  if (whmi == null || !baseline) return null;
  const pct = Math.round((baseline - whmi) / baseline * 100);
  const kind = pct === 0 ? 'typ' : (pct > 0 ? 'good' : 'high');
  const dir = pct >= 0 ? 'better' : 'worse';
  const short = pct === 0 ? '– 0%' : (pct > 0 ? `↑ ${pct}%` : `↓ ${Math.abs(pct)}%`);
  const vs = `${Math.abs(pct)}% ${dir} than your 30-day avg (${baseline})`;
  return { kind, pct, short, vs, baseline };
}
function rateVsEpa(whmi) {
  if (whmi == null) return null;
  const pct = Math.round((EPA_WHMI - whmi) / EPA_WHMI * 100);
  const kind = pct === 0 ? 'typ' : (pct > 0 ? 'good' : 'high');
  const dir = pct >= 0 ? 'better' : 'worse';
  const short = pct === 0 ? '– 0%' : (pct > 0 ? `↑ ${pct}%` : `↓ ${Math.abs(pct)}%`);
  return { kind, pct, short, vs: `${Math.abs(pct)}% ${dir} than EPA`, baseline: EPA_WHMI, vsEpa: true };
}
function currentEffRate(whmi, keys) {
  if (whmi == null) return null;
  const base = periodBaseline(keys);
  return base != null ? rateEff(whmi, base) : rateVsEpa(whmi);
}
function effChipHtml(rate) {
  if (!rate) return '';
  return `<div class="eff-gap"><span class="eff-chip ${rate.kind}" title="${esc((rate.vs || rate.short) + ' · EPA ' + EPA_WHMI + ' Wh/mi')}">${esc(rate.short)}</span></div>`;
}
function effNoteText(whmi, keys, kind) {
  const parts = [];
  const rate = currentEffRate(whmi, keys);
  if (rate) {
    if (rate.vsEpa) parts.push(`${rate.short} vs EPA ${EPA_WHMI} Wh/mi`);
    else parts.push(`${rate.short} vs your 30-day avg (${rate.baseline}) · EPA ${EPA_WHMI} Wh/mi`);
  } else if (whmi != null) {
    parts.push(`EPA ${EPA_WHMI} Wh/mi`);
  }

  const from = S.meta.energy_from;
  if (from) parts.push(`Parked drain starts ${fmtMd(from)}${kind === 'week' ? ', when telemetry began' : ''}`);
  return parts.join(' · ');
}
function setEffNote(text) {
  let el = document.getElementById('effnote');
  if (!el) {
    el = document.createElement('div');
    el.id = 'effnote';
    el.className = 'cap effnote';
    const sum = document.getElementById('summary');
    sum.insertAdjacentElement('afterend', el);
  }
  if (text) { el.hidden = false; el.classList.remove('reserve'); el.textContent = text; }
  else { el.hidden = true; el.textContent = ''; el.classList.toggle('reserve', S.view === 'month'); }
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
      { k: `${ELEC_ICO} Electric Cost`, v: val(money(t.elec)), cls: '' },
      { k: `${PUMP_ICO} Gas Cost`, v: val(money(t.gas)), cls: '' },
      { k: `${DBADGE} Saved`, v: val(money(t.save)), cls: 'hi-save' },
    ];
  } else {
    tiles = [
      { k: `${BOLT_ICO} Energy`, v: kwhVal(en.total), cls: '' },
      { k: `${WHEEL} Driving`, v: kwhVal(en.driving), cls: '' },
      { k: `${PARK_ICO} Parked`, v: en.known ? kwhVal(en.parked) : 'n/a', cls: '' },
      { k: `${GAUGE_ICO} Efficiency`, v: whmi != null ? val(whmi, 'Wh/mi') : '–', cls: 'hi-eff', mid: energyMode() ? effChipHtml(currentEffRate(whmi, keys)) : '' },
    ];
  }
  $('#summary').innerHTML = tiles.map(x =>
    `<div class="stat ${x.cls}"><div class="k">${x.k}</div><div class="v">${x.v}</div><div class="stat-foot">${x.mid || ''}</div></div>`
  ).join('');
  const kind = S.view;
  setEffNote(energyMode() && whmi != null ? effNoteText(whmi, keys, kind) : '');
}

function featureRows(feats, tone) {
  return (feats || []).filter(f => f.id !== 'elevation').map(f => {
    const name = FEAT_LABEL[f.id] || f.id;
    const zero = !f.kwh;
    const neg = f.kwh < 0;
    const width = Math.min(100, Math.abs(f.pct));
    const kwh = `${neg ? '−' : ''}${fmtKwh(Math.abs(f.kwh))}<small>kWh</small>`;
    const share = zero ? '' : `<span class="fdot">·</span><small class="fshare">${neg ? '−' : ''}${Math.abs(f.pct)}% of total</small>`;
    const tag = (!zero && f.src === 'estimated') ? '<small class="ftag">est</small>' : (!zero && f.src === 'measured') ? '<small class="ftag meas">meas</small>' : '';
    return `<div class="feat ${tone}${zero ? ' zero' : ''}${neg ? ' neg' : ''}">
      <span class="fico">${ico(f.id)}</span>
      <div class="fn">${esc(name)}${tag}</div>
      <div class="fk">${kwh}${share}</div>
      <div class="fbar" aria-hidden="true"><i class="${neg ? 'neg' : ''}" style="width:${width}%"></i></div>
    </div>`;
  }).join('');
}
function featStartsLabel() {
  const d = S.meta && S.meta.feature_from;
  if (!d) return 'Feature data is not available yet';
  const [y, m, da] = d.split('-').map(Number);
  const pretty = new Date(y, m - 1, da).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
  return 'Feature data starts ' + pretty;
}
function featureNotes(real, feats) {
  if (!real) return `<div class="exnote">${esc(featStartsLabel())}</div>`;
  const hasEst = (feats || []).some(f => f.src === 'estimated');
  return `<div class="exsub">Share of this period's feature energy${hasEst ? ' · est = estimated from feature status and pack power' : ''}</div>`;
}
function featureBox(id, feats, tone) {
  const real = !!(feats && feats.length);
  const open = OPEN.has(id);
  return `<div class="fbox${open ? ' open' : ''}" data-id="${esc(id)}">
    <button type="button" class="fhd" aria-expanded="${open ? 'true' : 'false'}">
      ${FEAT_ICO}<span class="fl">Feature energy usage</span>${CHEV}
    </button>
    <div class="fbody">
      ${featureNotes(real, feats)}
      ${real ? featureRows(feats, tone) : ''}
    </div>
  </div>`;
}
function sumFeats(items) {
  const acc = {};
  for (const it of items || []) {
    for (const f of (it.feats || []).filter(x => x.id !== 'elevation')) {
      const a = acc[f.id] || { id: f.id, kwh: 0, n: 0, measured: 0 };
      a.kwh += f.kwh || 0;
      a.n += 1;
      if (f.src === 'measured') a.measured += 1;
      acc[f.id] = a;
    }
  }
  const list = Object.values(acc);
  const tot = list.reduce((s, f) => s + Math.max(0, f.kwh), 0);
  const out = list.filter(f => Math.abs(f.kwh) >= 0.005).map(f => ({
    id: f.id,
    kwh: Math.round(f.kwh * 1000) / 1000,
    pct: tot ? Math.round(100 * Math.abs(f.kwh) / tot) : 0,
    src: f.measured === f.n ? 'measured' : 'estimated',
  }));
  const s = out.filter(f => f.id !== 'elevation').reduce((n, f) => n + f.pct, 0);
  if (out.length && s !== 100) {
    let i = 0;
    for (let j = 1; j < out.length; j++) if (out[j].id !== 'elevation' && Math.abs(out[j].kwh) > Math.abs(out[i].kwh)) i = j;
    if (out[i] && out[i].id !== 'elevation') out[i].pct += (100 - s);
  }
  return out;
}
function itemsInKeys(keys) {
  const set = new Set(keys);
  const trips = [], parked = [];
  const yms = new Set(keys.map(k => k.slice(0, 7)));
  for (const ym of yms) {
    const m = S.months[ym]; if (!m) continue;
    for (const t of (m.trips || [])) if (set.has(dayKeyTs(t.s))) trips.push(t);
    for (const p of (m.parked || [])) {
      if (set.has(dayKeyTs(p.s)) || set.has(dayKeyTs((p.e || p.s) - 1))) parked.push(p);
    }
  }
  return { trips, parked };
}
function periodFeatureBox(id, keys, parkedNote) {
  const { trips, parked } = itemsInKeys(keys || []);
  const dFeats = sumFeats(trips);
  const pFeats = sumFeats(parked);
  const real = dFeats.length + pFeats.length > 0;
  const open = OPEN.has(id);
  const body = real
    ? `${featureNotes(true, dFeats.concat(pFeats))}
      <div class="exsec">While driving</div>
      ${dFeats.length ? featureRows(dFeats, 'trip') : '<div class="exsub">No driving in this period</div>'}
      <div class="exsec">While parked${parkedNote ? ` · ${esc(parkedNote)}` : ''}</div>
      ${pFeats.length ? featureRows(pFeats, 'parked') : '<div class="exsub">No parked use in this period</div>'}`
    : featureNotes(false);
  return `<div class="fbox${open ? ' open' : ''}" data-id="${esc(id)}">
    <button type="button" class="fhd" aria-expanded="${open ? 'true' : 'false'}">
      ${FEAT_ICO}<span class="fl">Feature energy usage</span>${CHEV}
    </button>
    <div class="fbody">${body}</div>
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
      <span>${ELEC_ICO} ${money(t.elec)}${t.cest ? '<span class="tag"> est</span>' : ''}</span>
      <span class="pump">${PUMP_ICO} ${money(t.gas)}</span>
      <span class="g">${DBADGE} ${money(t.save)}<span class="sv">saved</span></span>
    </div>
    <div class="cap ratecap">${t.rate ? '$' + t.rate.toFixed(3) + '/kWh' : ''} · premium ${t.gp ? '$' + t.gp.toFixed(2) + '/gal' : ''} ${esc(t.garea || '')} · ${S.meta.mpg} mpg</div>
  </div>`;
}
function statBoxes(cells) {
  return `<div class="tg">${cells.map(c => `<div${c.cls ? ` class="${c.cls}"` : ''}><b>${c.v}</b><span>${esc(c.k)}</span></div>`).join('')}</div>`;
}
function batLabel(a, b) {
  const ok = v => v != null && v !== '' && !isNaN(+v);
  const ri = v => ok(v) ? String(Math.round(+v)) : '–';
  const txt = (!ok(a) && !ok(b)) ? '–' : `${ri(a)}% → ${ri(b)}%`;
  return `${BAT_STAT_ICO}<span class="batn">${txt}</span>`;
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
      { v: batLabel(t.soc0, t.soc1), k: 'battery', cls: 'batcell' },
      { v: num(t.kwh, 2), k: 'kWh' },
      { v: t.whmi ?? '–', k: 'Wh/mi' },
    ])}
    ${energyMode() ? '' : costRow(t)}
    ${energyMode() ? '' : fsdRow(t)}
    ${energyMode() ? featureBox(featId, t.feats, 'trip') : ''}
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
function stationBadgeClass(st) {
  if (!st) return 'pub';
  if (st.match === 'home' || /home/i.test(st.badge || '')) return 'home';
  if ((st.network || '').toLowerCase() === 'tesla' || /supercharger/i.test(st.badge || '')) return 'tesla';
  return 'pub';
}
function stationTitle(it) {
  const st = it.station;
  if (!st || !st.badge) return '';
  const chip = `<span class="stn-badge ${stationBadgeClass(st)}">${esc(st.badge)}</span>`;
  const name = st.site_name || '';
  const nameHtml = (st.match === 'home' || !name || name === st.badge) ? '' : `<span class="stn-name">${esc(name)}</span>`;
  return `<div class="stn-title">${chip}${nameHtml}</div>`;
}
function stationWhere(it, info) {
  const st = it.station;
  const label = (st && st.label) || it.label || it.where || 'Charger';
  let addr = (st && (st.address || st.official_address)) || it.where || '';
  if (st && st.match === 'home' && (!addr || addr === 'Home' || addr === label)) addr = '';
  if (st && addr && (addr === label || addr === st.badge)) addr = '';
  // If we have a station title, don't repeat the label as the address line.
  const showAddr = !!(addr && !(st && st.badge && addr === st.label));
  if (!st || !st.badge) {
    return `<div class="where">${esc(label)}${info ? `<span class="chinfo"> · ${esc(info)}</span>` : ''}</div>`;
  }
  if (!showAddr && !info) return '';
  return `<div class="where">${showAddr ? esc(addr) : ''}${info ? `${showAddr ? '<span class="chinfo"> · ' : '<span class="chinfo">'}${esc(info)}</span>` : ''}</div>`;
}
function stationMeta(it) {
  const st = it.station;
  if (!st) return '';
  const bits = [];
  if (st.stalls) bits.push(st.stalls + (st.gen ? ' ' + st.gen : '') + ' stall' + (st.stalls === 1 ? '' : 's'));
  else if (st.gen) bits.push(st.gen);
  if (st.max_kw) bits.push(st.max_kw + '\u00a0kW max');
  if (st.connector) bits.push(st.connector);
  if (st.peak_kw != null) bits.push('peak ' + num(st.peak_kw, st.peak_kw >= 10 ? 0 : 1) + '\u00a0kW');
  if (st.match_note) bits.push(st.match_note);
  if (!bits.length) return '';
  return `<div class="stn-meta">${esc(bits.join(' · '))}</div>`;
}
function chargeCard(it) {
  const ongoing = !!it.open;
  const when = `${timeTs(it.s)} – ${ongoing ? 'now' : timeTs(it.e)}`;
  const dur = fmtSpan(it.s, it.e);
  const added = it.added != null ? it.added : it.kwh;
  const kw = it.kw != null ? num(it.kw, 1) : '–';
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
    ${stationTitle(it)}
    ${stationWhere(it, info)}
    ${stationMeta(it)}
    ${statBoxes([
      { v: added != null ? '+' + num(added, added >= 10 ? 1 : 2) : '–', k: 'kWh' },
      { v: batLabel(it.soc0, it.soc1), k: 'battery', cls: 'batcell' },
      { v: kw, k: 'avg kW' },
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
      { v: batLabel(it.soc0, it.soc1), k: 'battery', cls: 'batcell' },
      { v: it.w != null ? fmtW(it.w) : '–', k: 'W' },
      { v: it.kwh_day != null ? num(it.kwh_day, 1) : '–', k: 'kWh/day' },
    ])}
    ${energyMode() ? featureBox(featId, it.feats, 'parked') : ''}
  </div>`;
}

function setTitle() {
  const prev = $('#prev'), next = $('#next');
  if (S.mode === 'report') {
    const groups = (window.REPORT && REPORT.groups) || [];
    const w = (typeof weekOf === 'function' && weekOf()) || (groups[REPORT.gidx] && defaultWeek && defaultWeek(groups[REPORT.gidx])) || null;
    $('#title').textContent = (w && w.window) || '';
    if (prev) prev.disabled = !groups.length || REPORT.archive || REPORT.gidx <= 0;
    if (next) next.disabled = !groups.length || REPORT.archive || REPORT.gidx >= groups.length - 1;
    if (typeof syncReportChrome === 'function') syncReportChrome();
    setModeClass();
    return;
  }
  if (prev) prev.disabled = false;
  if (next) next.disabled = false;
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
  const c = S.cur, first = new Date(c.getFullYear(), c.getMonth(), 1), last = new Date(c.getFullYear(), c.getMonth() + 1, 0);
  const start = weekStart(first), tk = keyOf(todayD());
  const monthKeys = rangeKeys(first, last);
  const tsum = sumDays(monthKeys);
  // One shared scale for the month: the highest gas $ is full bar height,
  // so a short-mileage day is visibly shorter than a long one.
  let barScale = 0;
  for (const mk of monthKeys) {
    const xd = S.meta.days[mk] || {};
    if ((xd.n || 0) > 0) barScale = Math.max(barScale, xd.gas || 0);
  }
  barScale = barScale || 0.01;
  let h = `<div class="dow">${DOW.map(d => `<div>${d[0]}</div>`).join('')}</div><div class="grid sgrid">`;
  for (let i = 0; i < 42; i++) {
    const d = addDays(start, i);
    if (i >= 35 && d.getMonth() !== c.getMonth()) break;
    const k = keyOf(d), inMon = d.getMonth() === c.getMonth();
    const x = S.meta.days[k] || {};
    const future = k > tk;
    const hasDrive = inMon && !future && (x.n || 0) > 0;
    h += `<div class="cell ${!inMon ? 'out' : ''} ${k === tk && inMon ? 'today' : ''}"${inMon ? ` data-day="${k}"` : ''}>`;
    h += `<div class="n">${d.getDate()}</div>`;
    if (hasDrive) {
      const elec = x.elec || 0, gas = x.gas || 0;
      const eH = Math.max(0, Math.min(100, Math.round(100 * elec / barScale)));
      const gH = Math.max(0, Math.min(100, Math.round(100 * gas / barScale)));
      h += `<div class="sbars" aria-hidden="true"><i class="sbar elec" style="height:${eH}%"></i><i class="sbar gas" style="height:${gH}%"></i></div>`;
      h += `<div class="s">${money(x.save || 0)}</div>`;
      if (x.mi) h += `<div class="m">${num(x.mi, 0)} mi</div>`;
    }
    h += '</div>';
  }
  h += '</div>';
  const avgs = [];
  const drivenDays = monthKeys.filter(k => (S.meta.days[k] || {}).n).length;
  if (drivenDays) {
    avgs.push(`<span>Avg <b>${money(tsum.save / drivenDays)}</b> saved/day driven</span>`);
    avgs.push(`<span><b>${money(tsum.elec / drivenDays)}</b> electric</span>`);
    avgs.push(`<span><b>${fmtCom(tsum.mi / drivenDays, 1)} mi</b>/day</span>`);
  }
  const cap = 'Bars = electric (green) vs gas (red) · green $ is what you saved · tap a day for trips';
  return `${h}
    ${avgs.length ? `<div class="avgs">${avgs.join('')}</div>` : ''}
    <p class="empty" style="padding:10px 0;font-size:12px">${esc(cap)}</p>`;
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
    <div class="wc"><span>${ELEC_ICO} ${money(x.elec || 0)}</span><span class="pump">${PUMP_ICO} ${money(x.gas || 0)}</span><span class="g">${DBADGE} ${money(x.save || 0)}<span class="sv">saved</span></span></div></div>`;
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
  // Parked-drain sentence is shown under the summary tiles with the efficiency rating.
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
function energyUseRow({ labelHtml, dataAttr, driving, parked, known, parked_w, charge, soc0, soc1, mx, mi, baseline }) {
  const tot = known ? driving + (parked || 0) : driving;
  // Longest consumption day fills 72% of the track, leaving room for charging on the same kWh scale.
  const FILL = 0.72;
  const scale = mx ? mx / FILL : 1;
  const used = tot + (charge || 0);
  const capped = used > scale + 0.05;
  const w = scale ? Math.min(1, used / scale) : 0;
  const denom = capped ? scale : (used || 1);
  const drvPct = denom ? (100 * driving / denom) : 0;
  const parkPct = known && denom ? (100 * (parked || 0) / denom) : 0;
  const chgPct = charge && denom ? (capped ? Math.max(0, 100 - drvPct - parkPct) : (100 * charge / denom)) : 0;
  const kwhDec = tot >= 100 ? 0 : 1;
  const label = known ? fmtCom(tot, kwhDec) : fmtCom(driving, kwhDec);
  const segs = `<i class="ed" style="width:${drvPct}%"></i>`
    + (known && parkPct ? `<i class="ep" style="width:${parkPct}%"></i>` : '')
    + (chgPct ? `<i class="ec${capped ? ' cap' : ''}" style="width:${chgPct}%"></i>` : '');
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
  const whmi = mi ? Math.round(driving * 1000 / mi) : null;
  if (whmi != null) {
    const rate = baseline ? rateEff(whmi, baseline) : null;
    const cls = rate ? `ei eff ${rate.kind}` : 'ei eff';
    const chip = rate ? ` <span class="eff-chip ${rate.kind}">${esc(rate.short)}</span>` : '';
    bits.push(`<span class="${cls}"${rate ? ` title="${esc(rate.vs)}"` : ''}>${GAUGE_ICO} ${whmi} Wh/mi${chip}</span>`);
  }
  return `<div class="ewk" ${dataAttr || ''}>
    ${labelHtml}
    <div class="em" style="--w:${Math.max(0, w).toFixed(3)}">
      <div class="etk">
        <span class="ebat">${socPctLabel(soc0)}</span>
        <div class="ebars">
          <div class="etrack"><div class="estk${capped ? ' cap' : ''}"${capped ? ' title="Charging exceeds this scale"' : ''}>${segs}</div>${capped ? '<i class="earr"></i>' : ''}</div>
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
  const weekBase = periodBaseline(keys);
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
      soc0: d.soc0, soc1: d.soc1, mx, mi: d.x.mi || 0, baseline: weekBase,
    });
  }).join('');
  const from = fmtMd(S.meta.energy_from);
  const note = periodNote('week', keys, en);
  return `<div class="pcard">
    ${note ? `<div class="cap enote">${esc(note)}</div>` : ''}
    <div class="elist period">${rows}</div>
    ${periodFeatureBox('week-feat', keys, from ? 'from ' + from + ' only' : '')}
  </div>`;
}

function effGaugeSvg() {
  const r = 15, cx = 20, cy = 20, gap = 144;
  const a1 = (180 + gap / 2) * Math.PI / 180;
  const a2 = (180 - gap / 2) * Math.PI / 180;
  const x1 = cx + r * Math.sin(a1), y1 = cy - r * Math.cos(a1);
  const x2 = cx + r * Math.sin(a2), y2 = cy - r * Math.cos(a2);
  const d = `M ${x1.toFixed(3)} ${y1.toFixed(3)} A ${r} ${r} 0 1 1 ${x2.toFixed(3)} ${y2.toFixed(3)}`;
  return `<svg class="egsvg" viewBox="0 0 40 40" overflow="visible" aria-hidden="true"><path d="${d}" fill="none" stroke-width="3.1" stroke-linecap="round"/></svg>`;
}
function viewMonthEnergy() {
  const c = S.cur, first = new Date(c.getFullYear(), c.getMonth(), 1), last = new Date(c.getFullYear(), c.getMonth() + 1, 0);
  const start = weekStart(first), tk = keyOf(todayD());
  const monthKeys = rangeKeys(first, last);
  const en = energySum(monthKeys);
  const baseline = periodBaseline(monthKeys);
  let h = `<div class="dow">${DOW.map(d => `<div>${d[0]}</div>`).join('')}</div><div class="grid egrid">`;
  for (let i = 0; i < 42; i++) {
    const d = addDays(start, i);
    if (i >= 35 && d.getMonth() !== c.getMonth()) break;
    const k = keyOf(d), inMon = d.getMonth() === c.getMonth();
    const x = S.meta.days[k] || {};
    const future = k > tk;
    const mi = x.mi || 0;
    const driving = x.kwh || 0;
    const whmi = (inMon && !future && mi) ? Math.round(driving * 1000 / mi) : null;
    h += `<div class="cell ${!inMon ? 'out' : ''} ${k === tk && inMon ? 'today' : ''}"${inMon ? ` data-day="${k}"` : ''}>`;
    h += `<div class="n">${d.getDate()}</div>`;
    if (whmi != null) {
      const rate = baseline ? rateEff(whmi, baseline) : null;
      const kind = rate ? rate.kind : '';
      h += `<div class="egauge${kind ? ' ' + kind : ''}">${effGaugeSvg()}<div class="eval">${whmi}</div><div class="eunit">Wh/mi</div>`;
      if (rate) h += `<span class="eff-chip ${rate.kind}" title="${esc(rate.vs)}">${esc(rate.short)}</span>`;
      h += `</div>`;
      if (mi) h += `<div class="m">${num(mi, 0)} mi</div>`;
    }
    h += '</div>';
  }
  h += '</div>';
  const avgs = [];
  const drivenDays = monthKeys.filter(k => (S.meta.days[k] || {}).n).length;
  const parkedDays = monthKeys.filter(k => (S.meta.days[k] || {}).parked_known);
  if (drivenDays) avgs.push(`<span>Avg <b>${fmtCom(en.driving / drivenDays, 1)} kWh</b>/day driven</span>`);
  if (parkedDays.length && en.known) avgs.push(`<span><b>${fmtCom(en.parked / parkedDays.length, 1)} kWh</b>/day parked since ${esc(fmtMd(S.meta.energy_from))}</span>`);
  if (en.whmi) avgs.push(`<span><b>${en.whmi} Wh/mi</b></span>`);
  const from = fmtMd(S.meta.energy_from);
  const cap = 'Gauge = Wh/mi vs your 30-day avg · green better, orange worse · tap a day for trips';
  return `${h}
    ${avgs.length ? `<div class="avgs">${avgs.join('')}</div>` : ''}
    <p class="empty" style="padding:10px 0;font-size:12px">${esc(cap)}</p>
    ${periodFeatureBox('month-feat', monthKeys, from ? 'from ' + from + ' only' : '')}`;
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
      soc0: mo.soc0, soc1: mo.soc1, mx, mi: mo.t.mi || 0, baseline: periodBaseline(mo.keys),
    });
  }).join('');
  const from = fmtMd(S.meta.energy_from);
  const note = periodNote('year', yearKeys, en);
  return `<div class="pcard">
    ${note ? `<div class="cap enote">${esc(note)}</div>` : ''}
    <div class="elist period">${rows}</div>
    ${periodFeatureBox('year-feat', yearKeys, from ? 'from ' + from + ' only' : '')}
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


/* ---- Automations: state and runs live on the droplet (/control/auto), behind the device token ---- */
const AUTO_CATS = ["Comfort","Security","Charging","Trips & Calendar","Insights","System"];
const AUTO_COLOR = {"Comfort":"#3e8bff","Security":"#ff5a4e","Charging":"#34c759","Trips & Calendar":"#e8a830","Insights":"#9b7dff","System":"#5ac8c8"};
const AUTO_ICO = {
  comfort:'<path d="M10 4v11.5a2.5 2.5 0 1 0 4 0V4"/><path d="M10 4h4M10 8h3M10 11h3"/>',
  snow:'<path d="M12 3v18M4.5 7.5 19.5 16.5M4.5 16.5 19.5 7.5"/><path d="M12 3l2 2M12 3l-2 2M12 21l2-2M12 21l-2-2"/>',
  lock:'<rect x="6" y="11" width="12" height="9" rx="2"/><path d="M8 11V8a4 4 0 0 1 8 0v3"/>',
  away:'<path d="M12 3 5 7v6c0 4.2 2.8 7.3 7 8.5 4.2-1.2 7-4.3 7-8.5V7l-7-4Z"/><path d="M12 10v2"/><circle cx="12" cy="15" r=".8" fill="currentColor" stroke="none"/>',
  storm:'<path d="M7.5 16H7a4 4 0 0 1 0-8 5.2 5.2 0 0 1 10-.8A3.5 3.5 0 1 1 17 16h-1.5"/><path d="M9 18l-1 3M12.5 18l-1 3M16 18l-1 3"/>',
  find:'<path d="M12 21s7-5.4 7-11a7 7 0 1 0-14 0c0 5.6 7 11 7 11Z"/><circle cx="12" cy="10" r="2.2"/>',
  valet:'<circle cx="8" cy="12" r="3.2"/><path d="M11 12h9M17 12v3M20 12v2"/>',
  cheap:'<circle cx="12" cy="12" r="8"/><path d="M12 7v5l3 2"/>',
  range:'<path d="M4.6 17.4a8.6 8.6 0 1 1 14.8 0"/><path d="M12 17.4 16.1 9.7"/><circle cx="12" cy="17.4" r="1.55" fill="currentColor" stroke="none"/>',
  trip:'<path d="M4 7h11l5 5v7H4V7Z"/><path d="M15 7v5h5M8 18v-3h4v3"/>',
  calendar:'<rect x="4" y="6" width="16" height="14" rx="2"/><path d="M8 4v4M16 4v4M4 11h16"/>',
  brief:'<path d="M5 18c3-6 11-6 14 0"/><circle cx="12" cy="9" r="3"/><path d="M12 3v1.5"/>',
  health:'<path d="M4 13h3l2-4 3 8 2-4h6"/><path d="M19 7V5M19 5h-2M19 5h2"/>',
  refresh:'<path d="M20 12a8 8 0 1 1-2.2-5.5"/><path d="M20 5v5h-5"/>',
  plus:'<path d="M12 6v12M6 12h12"/>',
  pencil:'<path d="M13.5 5.5 18.5 10.5"/><path d="M4 20l1.2-6.2L14.8 4.2a1.8 1.8 0 0 1 2.5 0l2.5 2.5a1.8 1.8 0 0 1 0 2.5L10.2 18.8 4 20Z"/>',
  chevron:'<path d="m6 9 6 6 6-6"/>',
  minus:'<path d="M6 12h12"/>'
};
function autoSvg(name, color, size=22){
  if (name === 'bolt') return `<svg width="${size}" height="${size}" viewBox="0 0 24 24" aria-hidden="true"><path fill="${color||'#fff'}" d="M13.2 2.5 5.8 13.2h5.3l-.8 8.3 8.2-12.2h-5.4z"/></svg>`;
  return `<svg width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" stroke="${color||'currentColor'}" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${AUTO_ICO[name]||''}</svg>`;
}
const AUTO_DEFAULTS = [
  {id:"smart-comfort",cat:"Comfort",name:"Smart Comfort",icon:"comfort",on:true,action:"Precondition the cabin to 71°F, plus seat and steering wheel heat when it's cold. Skip if the weather is already mild.",triggers:["Daily forecast check","Weekday departure-to-work time","Weekday finish-work time"]},
  {id:"snow-ice",cat:"Comfort",name:"Snow & Ice Prep",icon:"snow",on:true,action:"Start max defrost and heat earlier than usual, and tell Lei if he should leave earlier.",triggers:["Overnight low below 32°F or snow in the forecast","30 min before weekday departure"]},
  {id:"nightly-lock",cat:"Security",name:"Nightly Lock Check",icon:"lock",on:true,action:"If the truck is unlocked, a window is open, or the tonneau is open, lock and close them — or ask Lei first.",triggers:["Every night at 10:00 PM"]},
  {id:"away-watch",cat:"Security",name:"Away Watch",icon:"away",on:false,action:"Turn on Sentry, send a daily status, and alert if battery drain looks unusual while Lei is traveling.",triggers:["Lei marks himself as traveling","Daily check-in at 8:00 AM"]},
  {id:"storm-guard",cat:"Security",name:"Storm Guard",icon:"storm",on:true,action:"Close the windows and tonneau and turn on Sentry if they're left open in bad weather.",triggers:["Forecast shows rain, snow, or hail","Truck is parked with windows or the tonneau open"]},
  {id:"parking-alert",cat:"Security",name:"Parking Alert",icon:"find",on:true,action:"Alert if the truck is left unlocked, or if it's parked somewhere new overnight.",triggers:["Truck unlocked for more than 10 min while parked","Overnight location is not home or a usual spot"]},
  {id:"valet",cat:"Security",name:"Guest & Valet Handoff",icon:"valet",on:false,action:"Turn on valet or guest mode with a speed limit when Lei is lending the truck, then turn them off at the end time.",triggers:["Lei says he's lending the truck","A set end time"]},
  {id:"charging-nudge",cat:"Charging",name:"Charging Nudge",icon:"bolt",on:true,action:"Remind Lei to plug in if the truck isn't already charging.",triggers:["Weeknights, if not plugged in by 9:00 PM","Friday, if the battery is below 60% before the weekend"]},
  {id:"cheap-rate",cat:"Charging",name:"Cheap-Rate Charging",icon:"cheap",on:true,action:"Charge in the cheapest DTE hours and set weekday vs weekend charge limits. Peak is Mon–Fri 3–7 PM.",triggers:["Plugged in at home","Outside the DTE D1.11 peak window"]},
  {id:"range-check",cat:"Trips & Calendar",name:"Range Check",icon:"range",on:true,action:"Answer “Can I make it to X and back without charging?” from live range.",triggers:["On demand in chat"]},
  {id:"road-trip",cat:"Trips & Calendar",name:"Road Trip Prep",icon:"trip",on:true,action:"Raise the charge limit to 100% the night before a trip, then precondition at departure.",triggers:["A trip event on Lei's calendar, or a “trip tomorrow” message"]},
  {id:"calendar-depart",cat:"Trips & Calendar",name:"Calendar Departure",icon:"calendar",on:true,action:"Precondition based on the next calendar event's location and time, not a fixed daily schedule.",triggers:["Calendar event with a location","Drive-time estimate"]},
  {id:"morning-brief",cat:"Insights",name:"Morning Briefing",icon:"brief",on:true,action:"One message with battery, range, cabin temp, lock state, and whether a software update is pending.",triggers:["Weekday mornings before departure"]},
  {id:"weekly-health",cat:"Insights",name:"Weekly Health Report",icon:"health",on:true,action:"Weekly summary of miles, battery health trend, idle drain, Sentry events, and tire-related warnings.",triggers:["Sunday evening"]},
  {id:"login-fresh",cat:"System",name:"Keep Tesla login fresh",icon:"refresh",on:true,action:"Renew the Fleet API token from the box and sync it to the droplet.",triggers:["Every 5 hours (CRON 0 */5 * * * ET)"]}
];
const AUTO_API = 'https://146-190-255-1.sslip.io/control/auto';
const AUTO = { features: [], filter: 'All', open: null, editing: null, view: 'list', srv: null, loading: false, err: '', log: null, synced: 0, busy: false };
const AUTO_MODE_CHIP = {
  'dry-run': ['Dry run', 'dry'], live: ['Live', 'live'], notify: ['Notify', 'notify'], none: ['Manual', 'manual'], box: ['On the box', 'manual']
};
const AUTO_STATUS = {
  'dry-run': 'Dry run', ok: 'Done', failed: 'Failed', blocked: 'Blocked', skipped: 'Skipped', 'no-action': 'Nothing needed',
  notified: 'Notified', asked: 'Asked you', approved: 'Approved', 'skipped-by-lei': 'You skipped', running: 'Running', duplicate: 'Duplicate'
};
function autoToken() { try { return typeof ctlToken === 'function' ? ctlToken() : ''; } catch (e) { return ''; } }
function autoWhen(ts) {
  if (!ts) return '—';
  const d = new Date(ts * 1000);
  const t = d.toLocaleTimeString('en-US', { timeZone: TZ, hour: 'numeric', minute: '2-digit' });
  if (dayKeyTs(ts) === fmtParts.format(new Date())) return t;
  return d.toLocaleDateString('en-US', { timeZone: TZ, weekday: 'short' }) + ' ' + t;
}
async function autoFetch(path, body) {
  const tok = autoToken();
  if (!tok) throw new Error('no-token');
  const opt = { method: body ? 'POST' : 'GET', headers: { Authorization: 'Bearer ' + tok }, cache: 'no-store' };
  if (body) { opt.headers['Content-Type'] = 'application/json'; opt.body = JSON.stringify(body); }
  const r = await fetch(AUTO_API + path, opt);
  const data = await r.json().catch(() => ({}));
  if (r.status === 401 && !body) { if (typeof clearCtlToken === 'function') clearCtlToken(); throw new Error('auth'); }
  if (!r.ok) { const e = new Error(data.error || ('HTTP ' + r.status)); e.status = r.status; e.data = data; throw e; }
  return data;
}
function loadAutos() {
  let cached = null;
  try { cached = JSON.parse(localStorage.getItem('ht_auto_srv') || 'null'); } catch (e) { cached = null; }
  if (cached && Array.isArray(cached.cards)) { AUTO.srv = cached; AUTO.features = cached.cards; }
  else AUTO.features = AUTO_DEFAULTS.map(f => ({ ...f, triggers: f.triggers.slice() }));
  const f = localStorage.getItem('ht_auto_filter');
  AUTO.filter = AUTO_CATS.includes(f) ? f : 'All';
}
function saveAutos() { try { localStorage.setItem('ht_auto_filter', AUTO.filter); } catch (e) {} }
function applyAutoState(st) {
  if (!st || !Array.isArray(st.cards)) return;
  AUTO.srv = st; AUTO.features = st.cards; AUTO.err = '';
  try { localStorage.setItem('ht_auto_srv', JSON.stringify(st)); } catch (e) {}
}
async function syncAutos(force) {
  if (!autoToken() || AUTO.loading) return;
  if (!force && Date.now() - AUTO.synced < 15000) return;
  AUTO.loading = true;
  try {
    let st = await autoFetch('/state');
    // one-time migration of edits made on this device in the old local mock
    let local = null;
    try { local = JSON.parse(localStorage.getItem('ht_autos') || 'null'); } catch (e) { local = null; }
    if (local && Array.isArray(local.features) && !localStorage.getItem('ht_autos_migrated')) {
      if (!st.migrated) { const m = await autoFetch('/migrate', { features: local.features }); if (m.state) st = m.state; }
      localStorage.setItem('ht_autos_migrated', '1');
    }
    applyAutoState(st);
    AUTO.synced = Date.now();
  } catch (e) {
    AUTO.err = e.message === 'auth' || e.message === 'no-token' ? '' : 'Couldn’t reach the automation server. Showing the last copy.';
  } finally {
    AUTO.loading = false;
    if (S.mode === 'automation') renderAutomation();
  }
}
loadAutos();

function autoChips(f) {
  const out = [];
  if (f.klass === 'ask') out.push('<span class="auto-chip ask">Ask first</span>');
  const m = AUTO_MODE_CHIP[f.mode || (f.klass === 'notify' ? 'notify' : f.klass === 'box' ? 'box' : (f.rule ? 'dry-run' : 'none'))];
  if (m) out.push(`<span class="auto-chip ${m[1]}">${m[0]}</span>`);
  return out.join('');
}
function autoMetaLine(f) {
  if (!f.rule) return f.note ? `<div class="auto-meta">${esc(f.note)}</div>` : '';
  const last = f.last_run ? `Last ${esc(autoWhen(f.last_run.ts))} · ${esc(AUTO_STATUS[f.last_run.status] || f.last_run.status)}` : 'Last —';
  const next = f.on && f.next_run ? `Next ${esc(autoWhen(f.next_run.ts))}` : (f.on ? 'Next —' : 'Off');
  return `<div class="auto-meta"><span>${last}</span><span class="dot">•</span><span>${next}</span></div>`;
}
function autoParamText(f) {
  const sch = f.params_schema || {};
  const ks = Object.keys(sch);
  if (!ks.length) return '';
  return `<div class="auto-lab">Settings:</div><ul class="auto-kv">${ks.map(k => {
    let v = (f.params || {})[k];
    if (sch[k].type === 'time' && v) { const [h, m] = v.split(':').map(Number); v = new Date(2000, 0, 1, h, m).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' }); }
    return `<li><span>${esc(sch[k].label)}</span><b>${esc(v)}</b></li>`;
  }).join('')}</ul>${f.params_source ? `<p class="auto-small">${esc(f.params_source)}</p>` : ''}`;
}
function autoRunsBlock(f) {
  if (!f.rule) return f.note ? `<p class="auto-small">${esc(f.note)}</p>` : '';
  const modeTxt = f.klass === 'notify' ? 'Notify only. Sends you an alert and never touches the truck.'
    : f.klass === 'ask' ? ('Asks you first. Nothing runs until you tap Approve and enter the confirm word' + (f.mode === 'live' ? ' and your PIN.' : '. Dry run now: approving won’t touch the truck.'))
    : (f.mode === 'live' ? 'Runs on its own (climate, seat and wheel heat only).' : 'Dry run: decides and alerts you, but sends nothing to the truck.');
  const cmds = (f.command_labels || []).length ? `<div class="auto-lab">Can send:</div><p class="auto-act">${esc(f.command_labels.join(', '))}${f.klass === 'ask' ? ' (each needs your approval)' : ''}</p>` : '';
  const lr = f.last_run;
  return `<div class="auto-runs">
    <div class="auto-lab">Mode:</div><p class="auto-act">${esc(modeTxt)}</p>
    ${cmds}
    <div class="auto-two">
      <div><div class="auto-lab">Last run</div><p class="auto-act">${lr ? `${esc(autoWhen(lr.ts))} · ${esc(AUTO_STATUS[lr.status] || lr.status)}<br><span class="auto-small">${esc(lr.reason || '')}</span>` : 'Not yet'}</p></div>
      <div><div class="auto-lab">Next run</div><p class="auto-act">${f.on && f.next_run ? `${esc(autoWhen(f.next_run.ts))}<br><span class="auto-small">${esc(f.next_run.label || '')}</span>` : (f.on ? '—' : 'Off')}</p></div>
    </div>
    ${autoParamText(f)}
  </div>`;
}
function autoCardHTML(f, expanded) {
  const color = AUTO_COLOR[f.cat] || 'var(--acc)';
  return `<article class="auto-card${f.on ? '' : ' off'}${expanded ? ' open' : ''}" data-id="${esc(f.id)}">
    <div class="auto-row">
      <button type="button" class="auto-hit">
        <div class="auto-badge" style="background:${color}">${autoSvg(f.icon, '#fff', 20)}</div>
        <div class="auto-name">${esc(f.name)} ${autoChips(f)}</div>
      </button>
      <button type="button" class="auto-sw${f.on ? ' on' : ''}" style="--swc:${color}" aria-label="${f.on ? 'Turn off' : 'Turn on'} ${esc(f.name)}"${autoToken() ? '' : ' disabled'}><span class="track" aria-hidden="true"><span class="blk"></span></span></button>
      <button type="button" class="auto-chev" aria-label="Expand">${autoSvg('chevron', '#8b94a1')}</button>
    </div>
    ${expanded ? `<div class="auto-body">
      <div class="auto-actrow">
        <div style="flex:1">
          <div class="auto-lab">Action:</div>
          <div class="auto-act">${esc(f.action)}</div>
        </div>
        ${autoToken() ? `<button type="button" class="auto-pen" aria-label="Edit">${autoSvg('pencil', '#e9edf2', 18)}</button>` : ''}
      </div>
      <div class="auto-lab">Trigger:</div>
      <ol>${(f.triggers || []).map(t => `<li>${esc(t)}</li>`).join('')}</ol>
      ${autoRunsBlock(f)}
    </div>` : `<div class="auto-preview">${esc(f.action)}</div>${autoMetaLine(f)}`}
  </article>`;
}


function autoIsIOS() { return /iPad|iPhone|iPod/.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1); }
function autoStandalone() { return (window.matchMedia && matchMedia('(display-mode: standalone)').matches) || navigator.standalone === true; }
function autoPushOn() { try { return localStorage.getItem('ht_push_on') === '1' && 'Notification' in window && Notification.permission === 'granted'; } catch (e) { return false; } }
function autoPushPrompt() {
  if (!autoToken() || autoPushOn()) return '';
  let body;
  if (autoIsIOS() && !autoStandalone()) {
    body = `<p>To get alerts on this iPhone, add Happy Truck to your Home Screen: tap <b>Share</b>, then <b>Add to Home Screen</b>. Open it from the Home Screen and tap <b>Turn on alerts</b> here. Needs iOS 16.4 or later.</p>`;
  } else if (!('serviceWorker' in navigator) || !('PushManager' in window) || !('Notification' in window)) {
    body = `<p>This browser can’t receive push alerts. They’ll still show in Alerts here, and I’ll relay important ones in chat.</p>`;
  } else if (Notification.permission === 'denied') {
    body = `<p>Alerts are blocked for this site in your browser settings. Allow notifications for it, then come back.</p>`;
  } else {
    body = `<p>Get Approve / Skip prompts and alerts on this phone, even when the tracker is closed.</p>
      <button type="button" class="auto-pushbtn" data-auto="push-on"${AUTO.busy ? ' disabled' : ''}>Turn on alerts</button>`;
  }
  return `<div class="auto-push"><div class="auto-push-h">${autoSvg('brief', '#e8a830', 20)}<b>Alerts on this phone</b></div>${body}${AUTO.pushMsg ? `<p class="auto-small">${esc(AUTO.pushMsg)}</p>` : ''}</div>`;
}
function autoMaster() {
  const st = AUTO.srv || {};
  if (!autoToken()) {
    return `<div class="auto-master"><p class="auto-note" style="margin:0 0 10px">Automations run on the droplet. Enable remote controls on this device to see their runs and change them.</p>
      <button type="button" class="auto-pushbtn" data-auto="enable">Enable on this device</button></div>`;
  }
  const paused = !!st.paused;
  const sub = st.kill_switch ? 'Kill switch is on. Nothing runs.' : st.auth_stopped ? 'Stopped: Tesla login expired.' : paused ? 'Paused. Nothing runs until you turn this back on.'
    : (() => {
      const cs = st.cards || [];
      const live = cs.filter(c => c.mode === 'live').length, dry = cs.filter(c => c.on && c.mode === 'dry-run').length;
      return `Running. ${live} live` + (dry ? `, ${dry} in dry run.` : '.') + ' Ask-first cards still wait for your Approve.';
    })();
  const b = st.budgets || {};
  return `<div class="auto-master${paused || st.kill_switch ? ' paused' : ''}">
    <div class="auto-row">
      <div class="auto-badge" style="background:${paused || st.kill_switch ? '#5b616b' : '#3e8bff'}">${autoSvg('refresh', '#fff', 20)}</div>
      <div style="flex:1;min-width:0"><div class="auto-name">All automations</div><div class="auto-meta" style="margin:2px 0 0">${esc(sub)}</div></div>
      <button type="button" class="auto-sw${paused ? '' : ' on'}" data-auto="pause" style="--swc:#3e8bff" aria-label="${paused ? 'Resume' : 'Pause'} all automations"${st.kill_switch ? ' disabled' : ''}><span class="track" aria-hidden="true"><span class="blk"></span></span></button>
    </div>
    <div class="auto-tools">
      <button type="button" class="auto-tool" data-auto="alerts">Alerts${st.unread ? ` <span class="auto-count">${st.unread}</span>` : ''}</button>
      <button type="button" class="auto-tool" data-auto="log">Run log</button>
      <span class="auto-small" style="margin-left:auto">Wakes ${b.wakes_today ?? 0}/${b.wakes_cap ?? 6} · cmds ${b.cmds_today ?? 0}/${b.cmds_cap ?? 20} today</span>
    </div>
  </div>`;
}
function autoListHTML() {
  const counts = { All: AUTO.features.length };
  AUTO_CATS.forEach(c => { counts[c] = AUTO.features.filter(f => f.cat === c).length; });
  const tabs = ['All', ...AUTO_CATS].map(item => {
    const on = AUTO.filter === item ? ' on' : '';
    const dot = item === 'All' ? '' : `<span class="auto-dot" style="background:${AUTO_COLOR[item]}"></span>`;
    return `<button type="button" class="auto-cat${on}" data-cat="${esc(item)}">${dot}${esc(item)} ${counts[item] || 0}</button>`;
  }).join('');
  const cats = AUTO.filter === 'All' ? AUTO_CATS : AUTO_CATS.filter(c => c === AUTO.filter);
  let body = '';
  cats.forEach(cat => {
    const items = AUTO.features.filter(f => f.cat === cat);
    if (!items.length) return;
    body += `<h2 class="auto-sec" style="color:${AUTO_COLOR[cat]}">${esc(cat)}</h2><div class="auto-list">${items.map(f => autoCardHTML(f, AUTO.open === f.id)).join('')}</div>`;
  });
  if (!body) body = '<div class="empty">No automations in this category.</div>';
  return `<div id="auto-root">
    ${autoMaster()}
    ${autoPushPrompt()}
    ${AUTO.err ? `<p class="auto-err">${esc(AUTO.err)}</p>` : ''}
    <div class="auto-cats">${tabs}</div>
    ${autoToken() ? `<button type="button" class="auto-add"><span class="plus">${autoSvg('plus', '#fff', 16)}</span>Add New Automation</button>` : ''}
    ${body}
  </div>`;
}
function autoCardName(id) { const f = AUTO.features.find(x => x.id === id); return f ? f.name : (id === 'system' ? 'System' : id); }
function autoLogHTML() {
  if (!AUTO.log) return '<div class="empty">Loading the run log…</div>';
  if (!AUTO.log.length) return '<div class="empty">No runs yet.</div>';
  return `<div class="auto-loglist">${AUTO.log.map(r => {
    let acts = [];
    try { acts = JSON.parse(r.actions || '[]').map(a => a[0]); } catch (e) {}
    const cls = ['ok', 'approved'].includes(r.status) ? 'live' : ['failed', 'blocked'].includes(r.status) ? 'bad' : r.status === 'dry-run' ? 'dry' : r.status === 'asked' ? 'ask' : 'manual';
    return `<div class="auto-logrow">
      <div class="auto-logtop"><b>${esc(autoCardName(r.card))}</b><span class="auto-chip ${cls}">${esc(AUTO_STATUS[r.status] || r.status)}</span><span class="auto-small" style="margin-left:auto">${esc(autoWhen(r.ts))}</span></div>
      <div class="auto-small">${esc(r.reason || '')}${acts.length ? ` · ${r.dry_run ? 'would send' : 'sent'}: ${esc(acts.join(', '))}` : ''}${r.woke ? ' · woke truck' : ''}${String(r.run_id).startsWith('test:') ? ' · test' : ''}</div>
    </div>`;
  }).join('')}</div>`;
}
function autoAlertsHTML() {
  const notes = (AUTO.srv && AUTO.srv.notes) || [];
  if (!notes.length) return '<div class="empty">No alerts yet.</div>';
  return `<div class="auto-loglist">${notes.map(n => {
    const pending = n.approval_id && n.approval_status === 'pending';
    const st = n.approval_id && !pending ? `<span class="auto-chip manual">${esc(n.approval_status === 'skipped' ? 'You skipped' : n.approval_status === 'approved' ? 'Approved' : n.approval_status || '')}</span>` : '';
    return `<div class="auto-logrow${n.read ? '' : ' unread'}">
      <div class="auto-logtop"><b>${esc(n.title)}</b>${st}<span class="auto-small" style="margin-left:auto">${esc(autoWhen(n.ts))}</span></div>
      <div class="auto-act" style="font-size:14px">${esc(n.body)}</div>
      ${pending ? `<button type="button" class="auto-pushbtn" style="margin-top:8px" data-auto="review" data-aid="${esc(n.approval_id)}">Review</button>` : ''}
    </div>`;
  }).join('')}</div>`;
}
function autoTriggerRow(i, value) {
  return `<div class="auto-trow"><span class="n">${i + 1}.</span><input data-trig value="${esc(value)}"><button type="button" class="auto-rm" aria-label="Remove trigger">${autoSvg('minus', '#8b94a1')}</button></div>`;
}
function autoEditHTML(f) {
  const isNew = !f.id || String(f.id).startsWith('new-');
  const triggers = (f.triggers && f.triggers.length) ? f.triggers : [''];
  const sch = f.params_schema || {};
  const params = Object.keys(sch).map(k => {
    const s = sch[k], v = (f.params || {})[k];
    return `<label><span>${esc(s.label)}</span><input data-param="${esc(k)}" type="${s.type === 'time' ? 'time' : 'number'}"${s.type === 'int' ? ` min="${s.min}" max="${s.max}" inputmode="numeric"` : ''} value="${esc(v)}"></label>`;
  }).join('');
  return `<div class="auto-edit" data-id="${esc(f.id || '')}" data-new="${isNew ? '1' : '0'}">
    <label><span>Name</span><input id="auto-name" value="${esc(f.name || '')}" placeholder="Name"></label>
    <label><span>Category</span><select id="auto-cat">${AUTO_CATS.map(c => `<option${c === (f.cat || 'Comfort') ? ' selected' : ''}>${esc(c)}</option>`).join('')}</select></label>
    <label><span>Action</span><textarea id="auto-action" placeholder="What should happen?">${esc(f.action || '')}</textarea></label>
    <div style="margin-bottom:18px">
      <span class="auto-lab" style="display:block;margin-bottom:6px">Triggers</span>
      <div id="auto-trigs">${triggers.map((t, i) => autoTriggerRow(i, t)).join('')}</div>
      <button type="button" class="auto-addtrig">${autoSvg('plus', '#3e8bff', 18)} Add trigger</button>
    </div>
    ${params ? `<div class="auto-lab" style="margin-bottom:8px">Settings</div>${params}` : ''}
    ${isNew ? '<p class="auto-small" style="margin:0 0 14px">New cards are saved and synced, but they don’t run until the engine has a rule for them. Tell me what it should do.</p>' : ''}
    ${f.rule ? `<p class="auto-small" style="margin:0 0 14px">What this card is allowed to send is fixed on the server and can’t be changed here.</p>` : ''}
    ${AUTO.editErr ? `<p class="auto-err">${esc(AUTO.editErr)}</p>` : ''}
    <div class="auto-rowbtns">
      <button type="button" class="auto-btn save"${AUTO.busy ? ' disabled' : ''}>Save</button>
      <button type="button" class="auto-btn cancel">Cancel</button>
    </div>
    ${isNew ? '' : '<button type="button" class="auto-del">Delete automation</button>'}
  </div>`;
}
function renumberTriggers() {
  document.querySelectorAll('#auto-trigs .auto-trow .n').forEach((el, i) => { el.textContent = (i + 1) + '.'; });
}
function autoTitle() {
  if (AUTO.editing != null) return 'Edit automation';
  return AUTO.view === 'log' ? 'Run log' : AUTO.view === 'alerts' ? 'Alerts' : 'Automations';
}
function renderAutomation() {
  const note = document.getElementById('effnote');
  if (note) { note.hidden = true; note.textContent = ''; }
  const main = $('#main');
  if (AUTO.editing != null) {
    const isNew = AUTO.editing === '__new__' || String(AUTO.editing).startsWith('new-');
    const f = isNew && AUTO.editing === '__new__'
      ? { id: 'new-' + Date.now(), cat: 'Comfort', name: '', icon: 'plus', on: true, action: '', triggers: [''] }
      : (AUTO.features.find(x => x.id === AUTO.editing) || { id: AUTO.editing, cat: 'Comfort', name: '', icon: 'plus', on: true, action: '', triggers: [''] });
    if (AUTO.editing === '__new__') { AUTO.editing = f.id; }
    main.innerHTML = autoEditHTML(f);
  } else if (AUTO.view === 'log') {
    main.innerHTML = autoLogHTML();
  } else if (AUTO.view === 'alerts') {
    main.innerHTML = autoAlertsHTML();
  } else {
    main.innerHTML = autoListHTML();
  }
  setModeClass();
  if (AUTO.view === 'list' && AUTO.editing == null) void syncAutos(false);
}


function readAutoForm() {
  const name = ($('#auto-name') && $('#auto-name').value || '').trim();
  const cat = ($('#auto-cat') && $('#auto-cat').value) || 'Comfort';
  const action = ($('#auto-action') && $('#auto-action').value || '').trim();
  const triggers = [...document.querySelectorAll('#auto-trigs input[data-trig]')].map(i => i.value.trim()).filter(Boolean);
  const params = {};
  document.querySelectorAll('.auto-edit input[data-param]').forEach(i => { params[i.dataset.param] = i.type === 'number' ? Number(i.value) : i.value; });
  return { name, cat, action, triggers, params };
}
function defaultIcon(cat) {
  return { Comfort: 'comfort', Security: 'lock', Charging: 'bolt', 'Trips & Calendar': 'trip', Insights: 'brief', System: 'refresh' }[cat] || 'plus';
}
async function autoPost(path, body, okFn) {
  if (AUTO.busy) return;
  AUTO.busy = true;
  try {
    const r = await autoFetch(path, body);
    if (r.state) applyAutoState(r.state);
    if (okFn) okFn(r);
    AUTO.editErr = '';
  } catch (e) {
    if (AUTO.editing != null) AUTO.editErr = e.message === 'no-token' ? 'Enable remote controls first.' : 'Couldn’t save: ' + e.message;
    else AUTO.err = 'Couldn’t save: ' + e.message;
  } finally {
    AUTO.busy = false;
    renderAutomation();
  }
}
async function autoOpenView(v) {
  AUTO.view = v; AUTO.open = null;
  if (v === 'log') {
    AUTO.log = null; renderAutomation();
    try { AUTO.log = (await autoFetch('/log?limit=120')).runs || []; } catch (e) { AUTO.log = []; AUTO.err = 'Couldn’t load the run log.'; }
  } else if (v === 'alerts') {
    renderAutomation();
    try { await autoFetch('/notes/read', {}); applyAutoState(await autoFetch('/state')); } catch (e) {}
  }
  if (S.mode === 'automation') renderAutomation();
}
function handleAutoClick(e) {
  const tool = e.target.closest('[data-auto]');
  if (tool) {
    const a = tool.dataset.auto;
    if (a === 'enable') {
      if (window.CONTROL) { CONTROL.enablePrompt = true; CONTROL.enableError = ''; CONTROL.view = 'home'; }
      S.mode = 'control'; localStorage.setItem('ht_mode', 'control'); render(); return;
    }
    if (a === 'pause') { const p = !(AUTO.srv && AUTO.srv.paused); void autoPost('/pause', { paused: p }); return; }
    if (a === 'log' || a === 'alerts') { void autoOpenView(a); return; }
    if (a === 'push-on') { void autoEnablePush(); return; }
    if (a === 'review') { void openApproval(tool.dataset.aid); return; }
  }
  const catBtn = e.target.closest('.auto-cat');
  if (catBtn) { AUTO.filter = catBtn.dataset.cat || 'All'; saveAutos(); renderAutomation(); return; }
  if (e.target.closest('.auto-add')) { AUTO.editing = '__new__'; AUTO.open = null; AUTO.editErr = ''; renderAutomation(); return; }
  const sw = e.target.closest('.auto-sw');
  if (sw) {
    const id = sw.closest('.auto-card').dataset.id;
    const f = AUTO.features.find(x => x.id === id);
    if (f) { f.on = !f.on; renderAutomation(); void autoPost('/card', { id, on: f.on }); }
    return;
  }
  const pen = e.target.closest('.auto-pen');
  if (pen) { AUTO.editing = pen.closest('.auto-card').dataset.id; AUTO.editErr = ''; renderAutomation(); return; }
  const chev = e.target.closest('.auto-chev') || e.target.closest('.auto-hit');
  if (chev) { const id = chev.closest('.auto-card').dataset.id; AUTO.open = AUTO.open === id ? null : id; renderAutomation(); return; }
  if (e.target.closest('.auto-addtrig')) {
    const box = $('#auto-trigs');
    if (box) box.insertAdjacentHTML('beforeend', autoTriggerRow(box.querySelectorAll('.auto-trow').length, ''));
    return;
  }
  const rm = e.target.closest('.auto-rm');
  if (rm) { const row = rm.closest('.auto-trow'); if (row) row.remove(); renumberTriggers(); return; }
  if (e.target.closest('.auto-btn.save')) {
    const form = $('.auto-edit');
    const data = readAutoForm();
    if (!data.name) { const el = $('#auto-name'); if (el) el.focus(); return; }
    const isNew = form.dataset.new === '1';
    const body = isNew ? { name: data.name, cat: data.cat, action: data.action, triggers: data.triggers, on: true, icon: defaultIcon(data.cat) }
      : { id: form.dataset.id, ...data };
    void autoPost('/card', body, r => { AUTO.editing = null; AUTO.open = r.id; });
    return;
  }
  if (e.target.closest('.auto-btn.cancel')) { AUTO.editing = null; AUTO.editErr = ''; renderAutomation(); return; }
  if (e.target.closest('.auto-del')) {
    if (!confirm('Delete this automation?')) return;
    const id = $('.auto-edit').dataset.id;
    void autoPost('/card/delete', { id }, () => { AUTO.editing = null; if (AUTO.open === id) AUTO.open = null; });
  }
}

/* ---- Approval sheet (ask-first). Single-use, 10-minute, server-side checks. ---- */
let AUTO_APPR_TIMER = 0;
function closeApproval() { clearInterval(AUTO_APPR_TIMER); $('#sheet').classList.add('hidden'); $('#sheet').classList.remove('auto-sheet'); }
async function openApproval(aid, act) {
  const sheet = $('#sheet'), bodyEl = $('#sheetbody');
  sheet.classList.add('auto-sheet');
  bodyEl.innerHTML = '<p class="auto-small">Loading request…</p>';
  sheet.classList.remove('hidden');
  if (!autoToken()) {
    bodyEl.innerHTML = `<h3 class="auto-sheet-h">Approval</h3><p class="auto-act">Enable remote controls on this device first (Control tab → Enable remote controls), then open this alert again.</p>
      <div class="auto-rowbtns" style="margin:16px 0 0"><button type="button" class="auto-btn cancel" id="appr-close">Close</button></div>`;
    $('#appr-close').onclick = closeApproval; return;
  }
  let a;
  try { a = await autoFetch('/approval?id=' + encodeURIComponent(aid)); }
  catch (e) { bodyEl.innerHTML = `<h3 class="auto-sheet-h">Approval</h3><p class="auto-act">That request wasn’t found.</p><div class="auto-rowbtns" style="margin:16px 0 0"><button type="button" class="auto-btn cancel" id="appr-close">Close</button></div>`; $('#appr-close').onclick = closeApproval; return; }
  const pending = a.status === 'pending';
  bodyEl.innerHTML = `<div class="auto-sheet-top"><span class="auto-chip ask">Ask first</span>${a.dry_run ? '<span class="auto-chip dry">Dry run</span>' : ''}<span class="auto-small" id="appr-left" style="margin-left:auto"></span></div>
    <h3 class="auto-sheet-h">${esc(a.label)}?</h3>
    <p class="auto-small" style="margin:0 0 6px">${esc(a.card_name)}</p>
    <p class="auto-act">${esc(a.body)}</p>
    ${a.dry_run ? '<p class="auto-small">Dry run: approving records what would happen and sends nothing to the truck.</p>' : ''}
    ${pending ? `<label class="auto-field"><span>Type <b>${esc(a.confirm_word)}</b> to approve</span><input id="appr-confirm" autocomplete="off" autocapitalize="characters" spellcheck="false"></label>
      ${a.needs_pin ? '<label class="auto-field"><span>Your 8-digit PIN</span><input id="appr-pin" type="password" inputmode="numeric" autocomplete="off" maxlength="8"></label>' : ''}
      <p class="auto-err" id="appr-err" hidden></p>
      <div class="auto-rowbtns" style="margin:16px 0 0">
        <button type="button" class="auto-btn cancel" id="appr-skip">Skip</button>
        <button type="button" class="auto-btn save" id="appr-go">Approve</button>
      </div>` : `<p class="auto-act"><b>This request was already ${esc(a.status === 'approved' ? 'approved' : a.status === 'skipped' ? 'skipped' : a.status)}.</b></p>
      <div class="auto-rowbtns" style="margin:16px 0 0"><button type="button" class="auto-btn cancel" id="appr-close">Close</button></div>`}`;
  const left = $('#appr-left');
  const tickLeft = () => {
    const s = a.expires - Math.floor(Date.now() / 1000);
    if (left) left.textContent = pending ? (s > 0 ? `Expires in ${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}` : 'Expired') : '';
  };
  tickLeft(); clearInterval(AUTO_APPR_TIMER); AUTO_APPR_TIMER = setInterval(tickLeft, 1000);
  if (!pending) { $('#appr-close').onclick = closeApproval; return; }
  const err = m => { const el = $('#appr-err'); el.hidden = false; el.textContent = m; };
  const send = async decision => {
    const pin = $('#appr-pin') ? $('#appr-pin').value : '';
    const confirmWord = $('#appr-confirm').value;
    if ($('#appr-pin')) $('#appr-pin').value = '';
    try {
      const r = await autoFetch('/approval', { id: a.id, decision, confirm: confirmWord, pin });
      bodyEl.innerHTML = `<h3 class="auto-sheet-h">${decision === 'skip' ? 'Skipped' : r.status === 'dry-run' ? 'Approved (dry run)' : r.status === 'ok' ? 'Done' : 'Not done'}</h3>
        <p class="auto-act">${decision === 'skip' ? 'Nothing was sent to the truck.' : r.status === 'dry-run' ? `Would have sent: ${esc(a.label)}. Nothing was sent to the truck.` : r.status === 'ok' ? `${esc(a.label)} sent${r.result && r.result.confirmed ? ' and confirmed.' : '. Not yet confirmed by the truck.'}` : esc((r.result && r.result.blocked) || 'The command didn’t go through.')}</p>
        <div class="auto-rowbtns" style="margin:16px 0 0"><button type="button" class="auto-btn cancel" id="appr-close">Close</button></div>`;
      clearInterval(AUTO_APPR_TIMER);
      $('#appr-close').onclick = closeApproval;
      void syncAutos(true);
    } catch (e) {
      err(e.message === 'confirm mismatch' ? `Type ${a.confirm_word} exactly.` : e.message === 'auth failed' ? 'That PIN didn’t work.' : e.message === 'expired' ? 'This request expired.' : 'Couldn’t send: ' + e.message);
    }
  };
  $('#appr-go').onclick = () => send('approve');
  $('#appr-skip').onclick = () => send('skip');
  if (act === 'skip') setTimeout(() => $('#appr-skip') && $('#appr-skip').focus(), 50);
  else setTimeout(() => $('#appr-confirm') && $('#appr-confirm').focus(), 50);
}

/* ---- Web Push setup ---- */
function autoB64u(s) { const p = '='.repeat((4 - s.length % 4) % 4); const b = atob((s + p).replace(/-/g, '+').replace(/_/g, '/')); return Uint8Array.from(b, c => c.charCodeAt(0)); }
async function autoEnablePush() {
  AUTO.busy = true; AUTO.pushMsg = 'Turning on alerts…'; renderAutomation();
  try {
    const perm = await Notification.requestPermission();
    if (perm !== 'granted') throw new Error('Notifications weren’t allowed.');
    const reg = await navigator.serviceWorker.ready;
    const { key } = await autoFetch('/push/key');
    let sub = await reg.pushManager.getSubscription();
    if (!sub) sub = await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: autoB64u(key) });
    await autoFetch('/push/subscribe', { subscription: sub.toJSON() });
    await autoFetch('/push/test', {});
    localStorage.setItem('ht_push_on', '1');
    AUTO.pushMsg = 'Alerts are on. A test alert is on its way.';
  } catch (e) {
    AUTO.pushMsg = 'Couldn’t turn on alerts: ' + (e.message || e);
  } finally {
    AUTO.busy = false; void syncAutos(true); renderAutomation();
  }
}
function autoHandleHash() {
  const h = new URLSearchParams(location.hash.slice(1));
  const aid = h.get('approve');
  if (aid) {
    history.replaceState(null, '', location.pathname);
    S.mode = 'automation'; localStorage.setItem('ht_mode', 'automation'); render();
    void openApproval(aid, h.get('act'));
  } else if (location.hash === '#alerts') {
    history.replaceState(null, '', location.pathname);
    S.mode = 'automation'; render(); void autoOpenView('alerts');
  }
}
if ('serviceWorker' in navigator) {
  navigator.serviceWorker.addEventListener('message', ev => {
    const d = ev.data || {};
    if (d.type === 'ht-open' && d.hash) { location.hash = d.hash; autoHandleHash(); }
  });
}



async function render() {
  stopPlayers();
  for (const k in MAPS) { try { MAPS[k].remove(); } catch (e) {} delete MAPS[k]; }
  localStorage.setItem('ht_view', S.view);
  localStorage.setItem('ht_mode', S.mode);
  setTitle();
  if (S.mode === 'automation') {
    renderAutomation();
    return;
  }
  if (S.mode === 'report') {
    if (window.renderReport) renderReport();
    return;
  }
  if (S.mode === 'control') {
    if (window.renderControl) renderControl();
    return;
  }
  if (S.mode === 'daily') {
    if (window.renderDaily) renderDaily();
    return;
  }
  renderSummary();
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
  if (S.mode === 'automation' || S.mode === 'control' || S.mode === 'daily') return;
  if (S.mode === 'report') { if (window.moveReport) moveReport(dir); return; }
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
  document.querySelectorAll('#tabbar button').forEach(b => {
    b.onclick = () => {
      const mode = b.dataset.mode;
      if (!mode) return;
      if (mode === S.mode) {
        if (mode === 'automation' && (AUTO.editing != null || AUTO.view !== 'list')) { AUTO.editing = null; AUTO.view = 'list'; render(); }
        if (mode === 'control' && window.CONTROL && CONTROL.view !== 'home') { CONTROL.view = 'home'; CONTROL.detail = null; render(); }
        return;
      }
      S.mode = mode;
      localStorage.setItem('ht_mode', S.mode);
      if (mode !== 'automation') { AUTO.editing = null; AUTO.view = 'list'; }
      if (mode !== 'report' && window.REPORT) { REPORT.archive = false; if (window.stopReportAudio) stopReportAudio(); }
      OPEN.clear();
      render();
    };
  });
  $('#autoback').onclick = () => { if (AUTO.editing != null) AUTO.editing = null; else AUTO.view = 'list'; render(); };
  $('#main').addEventListener('click', e => {
    if (S.mode === 'automation') { handleAutoClick(e); return; }
    if (S.mode === 'control') { if (window.handleControlClick) { handleControlClick(e); } return; }
    if (S.mode === 'daily') { if (window.handleDailyClick) handleDailyClick(e); return; }
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
  $('#sheet').onclick = e => { if (e.target.id === 'sheet') { if (typeof closeApproval === 'function') closeApproval(); else $('#sheet').classList.add('hidden'); } };
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
function show() { $('#app').classList.remove('hidden'); wire(); render(); try { autoHandleHash(); } catch (e) {} }
if ('serviceWorker' in navigator) {
  navigator.serviceWorker.register('sw.js', { updateViaCache: 'none' }).catch(() => {});
  let reloading = false;
  const reloadOnce = v => {
    if (reloading) return;
    const key = 'ht-sw-reloaded:' + (v || '1');
    try {
      if (sessionStorage.getItem(key)) return;
      sessionStorage.setItem(key, '1');
    } catch (err) {}
    reloading = true;
    location.reload();
  };
  navigator.serviceWorker.addEventListener('message', ev => {
    const d = ev.data || {};
    if (d && d.type === 'ht-sw-updated') reloadOnce(d.v);
  });
  // A new worker took over a page that was already controlled — reload once.
  // Skip if this load had no controller yet, so the first install doesn't loop.
  if (navigator.serviceWorker.controller) {
    navigator.serviceWorker.addEventListener('controllerchange', () => reloadOnce('controller'));
  }
}
window.htStart = start;
start();
