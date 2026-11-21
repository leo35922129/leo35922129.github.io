/* v106 Trips tab: Explore | Trip. Explore asks the droplet (/api/trips/*, device-token auth, keys stay server-side) for
   route, weather, NWS alerts and Balanced/Cheapest/Fastest charging plans. Trip lists come from the encrypted meta
   (meta.trips.planned from Travel Planner, meta.trips.past detected from the drive log). Nothing here wakes the truck. */
(function () {
  const API = 'https://146-190-255-1.sslip.io/api/trips';
  const LS = 'ht_trips_explore', LSQ = 'ht_trips_queued';
  const T = window.TRIPS_UI = {
    sub: 'upcoming', plan: 'balanced', detail: null, day: 1, q: '', results: [], searching: false,
    data: null, dataKey: '', busy: false, err: '', nearOpen: false, addFor: null, addBusy: false, msg: '',
  };
  let ex = {};
  try { ex = JSON.parse(localStorage.getItem(LS) || '{}') || {}; } catch (e) { ex = {}; }
  const nextSat = () => { const d = new Date(); d.setDate(d.getDate() + ((6 - d.getDay() + 7) % 7 || 7)); return d; };
  const iso = d => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  if (!ex.start) { const s = nextSat(), e = new Date(s); e.setDate(e.getDate() + 1); ex.start = iso(s); ex.end = iso(e); }
  ex.depart = ex.depart || '08:00'; ex.soc = ex.soc || 90;
  const save = () => { try { localStorage.setItem(LS, JSON.stringify(ex)); } catch (e) {} };
  const queued = () => { try { return JSON.parse(localStorage.getItem(LSQ) || '{}') || {}; } catch (e) { return {}; } };

  const I = (p, w = 18, cls = 'ico') => `<svg class="${cls}" viewBox="0 0 24 24" width="${w}" height="${w}" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${p}</svg>`;
  const P = {
    search: '<circle cx="11" cy="11" r="6.5"/><path d="m20 20-4.2-4.2"/>',
    x: '<path d="M6 6l12 12M18 6 6 18"/>',
    plus: '<path d="M12 5v14M5 12h14"/>',
    check: '<path d="m5 12.5 4.5 4.5L19 7.5"/>',
    warn: '<path d="M12 3.5 2.8 19.5h18.4z"/><path d="M12 10v4.2M12 17h.01"/>',
    chev: '<path d="m9 6 6 6-6 6"/>',
    back: '<path d="M15 6 9 12l6 6"/>',
    home: '<path d="M4 11.5 12 5l8 6.5V20h-5.5v-5h-5v5H4z"/>',
    pin: '<path d="M12 21s-6-5.7-6-11a6 6 0 0 1 12 0c0 5.3-6 11-6 11z"/><circle cx="12" cy="10" r="2.2"/>',
    bed: '<path d="M3 18V7M3 13h18v5M21 13a3 3 0 0 0-3-3h-7v3"/><circle cx="7" cy="10.5" r="1.6"/>',
    star: '<path d="m12 4 2.4 5 5.4.6-4 3.7 1.1 5.3L12 16l-4.9 2.6 1.1-5.3-4-3.7 5.4-.6z"/>',
  };
  const fast = () => (typeof EV_PATHS !== 'undefined' ? EV_PATHS.fast : P.plus);
  const tripP = () => (typeof EV_PATHS !== 'undefined' ? EV_PATHS.trip : P.pin);
  const fmtMin = m => { if (m == null) return '–'; m = Math.round(m); const h = Math.floor(m / 60), r = m % 60; return h ? `${h} h${r ? ` ${r} min` : ''}` : `${r} min`; };
  const pct = v => v == null ? '–' : `${Math.round(v)}%`;
  const usd = v => v == null ? null : `$${(+v).toFixed(v >= 100 ? 0 : 2)}`;
  const dlabel = (s, opt) => { const [y, m, d] = s.split('-').map(Number); return new Date(y, m - 1, d).toLocaleDateString('en-US', opt || { weekday: 'short', month: 'short', day: 'numeric' }); };
  const range = d => { if (!d) return ''; const a = dlabel(d.start, { month: 'short', day: 'numeric' }); if (!d.end || d.end === d.start) return a;
    const sameM = d.start.slice(0, 7) === d.end.slice(0, 7); return `${a}–${sameM ? +d.end.slice(8) : dlabel(d.end, { month: 'short', day: 'numeric' })}`; };
  const ndays = () => { const a = new Date(ex.start + 'T12:00'), b = new Date((ex.end || ex.start) + 'T12:00'); return Math.max(1, Math.round((b - a) / 864e5) + 1); };
  const WX = c => c == null ? '' : c === 0 ? 'Clear' : c <= 2 ? 'Partly cloudy' : c === 3 ? 'Cloudy' : c <= 48 ? 'Fog' : c <= 57 ? 'Drizzle' : c <= 67 ? 'Rain' : c <= 77 ? 'Snow' : c <= 82 ? 'Showers' : c <= 86 ? 'Snow showers' : 'Storms';
  const tok = () => { try { return localStorage.getItem('ht_control_token') || ''; } catch (e) { return ''; } };

  async function api(path, opts = {}) {
    const go = () => fetch(API + path, { ...opts, headers: { ...(opts.headers || {}), Authorization: 'Bearer ' + tok() } });
    let r = await go();
    if (r.status === 401 && window.CONTROL && CONTROL._pass && typeof mintControlSession === 'function') { try { await mintControlSession(); } catch (e) {} r = await go(); }
    const j = await r.json().catch(() => ({}));
    if (r.status === 401) throw new Error('auth');
    if (!r.ok || !j.ok) throw new Error(j.error || ('HTTP ' + r.status));
    return j;
  }

  /* ---------- chrome ---------- */
  window.setTripsChrome = function () {
    const on = TAB_OF[S.mode] === 'trips';
    const app = $('#app'); if (app) app.classList.toggle('mode-trips', on);
    const b = document.querySelector('#tabbar button[data-mode="trips"] .tab-dot');
    if (b) b.hidden = !tripsAlert();
  };
  function tripsAlert() {
    const p = S.meta && S.meta.trips && S.meta.trips.planned;
    return !!(p && Object.values(p.items || {}).some(t => t.status !== 'done' && (t.alerts || []).length));
  }

  /* ---------- Explore ---------- */
  function searchCard() {
    const res = T.results.length ? `<div class="trp-res">${T.results.map((r, i) => `<button type="button" class="trp-resrow" data-pick="${i}">${I(P.pin, 18)}<span>${esc(r.label)}</span><small>${esc(r.country === 'CA' ? 'Canada' : '')}</small></button>`).join('')}</div>` : '';
    const socs = [70, 80, 90, 100].map(v => `<option value="${v}"${+ex.soc === v ? ' selected' : ''}>${v}%</option>`).join('');
    return `<div class="card trp-search">
      <label class="trp-q">${I(P.search, 20)}<input id="trp-q" type="search" enterkeyhint="search" autocomplete="off" placeholder="Where to?" value="${esc(T.q || (ex.dest && ex.dest.label) || '')}">${(T.q || ex.dest) ? `<button type="button" class="trp-clr" data-act="clear" aria-label="Clear">${I(P.x, 18)}</button>` : ''}</label>
      ${res}
      <div class="trp-when trp-dates">
        <label class="trp-chip trp-date"><input type="date" id="trp-start" value="${ex.start}" aria-label="Start date"></label>
        <span class="trp-arrow">→</span>
        <label class="trp-chip trp-date"><input type="date" id="trp-end" value="${ex.end}" min="${ex.start}" aria-label="End date"></label>
      </div>
      <div class="trp-when trp-opts">
        <span class="trp-chip">${I(P.home, 16)}Home</span>
        <label class="trp-chip">Leave <input type="time" id="trp-dep" value="${ex.depart}" step="900"></label>
        <label class="trp-chip">at <select id="trp-soc">${socs}</select></label>
      </div>
    </div>`;
  }
  function weatherCard(d) {
    const w = d.weather || {};
    const days = (w.days || []).map(x => `<div class="trp-wd"><b>${esc(dlabel(x.date, { weekday: 'short' }))} ${+x.date.slice(8)}</b><span class="trp-wx">${esc(WX(x.code))}</span><span class="trp-t">${x.hi != null ? Math.round(x.hi) + '°' : '–'}<small> / ${x.lo != null ? Math.round(x.lo) + '°' : '–'}</small></span><small>${x.pop != null ? x.pop + '% precip' : ''}${x.wind_mph != null ? ` · ${Math.round(x.wind_mph)} mph` : ''}</small></div>`).join('');
    const al = (d.alerts || []).map(a => `<div class="trp-alert">${I(P.warn, 18)}<span><b>${esc(a.event || 'Alert')}</b>${a.ends ? ` · until ${esc(new Date(a.ends).toLocaleString('en-US', { weekday: 'short', hour: 'numeric', minute: '2-digit' }))}` : ''}</span></div>`).join('');
    return `<div class="trp-sec">Weather · ${esc((d.dest && d.dest.label || '').split(',')[0])}</div>
      <div class="card trp-wcard">${days ? `<div class="trp-wrow">${days}</div>` : ''}${w.note ? `<div class="trp-note">${esc(w.note)}</div>` : ''}${al}
      <div class="trp-src">Open-Meteo forecast${(d.alerts || []).length || d.alerts_note == null ? ' · NWS alerts' : ''}${!(d.alerts || []).length && !d.alerts_note ? ': none active' : d.alerts_note ? ' · ' + esc(d.alerts_note) : ''}</div></div>`;
  }
  function curPlan(d) { const pl = d.plan && d.plan.plans; return pl ? pl[T.plan] || pl.balanced : null; }
  function tradeLine(d) {
    const tv = d.plan && d.plan.tradeoff_vs_baseline, t = tv && tv.plans && tv.plans[T.plan];
    if (!t) return '';
    const parts = [];
    if (t.extra_stops) parts.push(`${t.extra_stops > 0 ? '+' : ''}${t.extra_stops} stop${Math.abs(t.extra_stops) === 1 ? '' : 's'}`);
    if (t.extra_charge_minutes) parts.push(`${t.extra_charge_minutes > 0 ? '+' : '−'}${fmtMin(Math.abs(t.extra_charge_minutes))} charging`);
    if (t.extra_cost_usd != null && t.extra_cost_usd !== 0) parts.push(`${t.extra_cost_usd > 0 ? '+' : '−'}${usd(Math.abs(t.extra_cost_usd))}${t.cost_complete === false ? ' est' : ''}`);
    else if (t.extra_cost_usd == null && t.cost_complete === false) parts.push('cost n/a');
    const b = tv.baseline_settings || {};
    return `<div class="trp-trade">vs ${b.min_arrive_charger_pct ?? 15}/${b.min_arrive_dest_pct ?? 20}% plan: ${parts.length ? esc(parts.join(' · ')) : 'same stops and time'}</div>`;
  }
  function routeCard(d) {
    const p = curPlan(d), r = d.route || {};
    const stops = p ? p.stops.length : 0;
    const arr = p && p.arrive_soc_pct != null ? p.arrive_soc_pct : d.plan && d.plan.prediction_no_stops && d.plan.prediction_no_stops.arrive_soc_pct;
    const tot = p ? p.total_minutes : r.minutes;
    const ret = d.plan && d.plan.return_needs_stop;
    return `<div class="trp-sec">Route</div>
    <div class="card trp-route">
      <div class="trp-rline"><b>${Math.round(r.miles)} mi</b><small class="trp-ow">one way</small><span>·</span><b>${fmtMin(tot)}</b><span>·</span><b>${stops} stop${stops === 1 ? '' : 's'}</b><small class="ftag">est</small></div>
      <div class="trp-rsub">Arrive ${pct(arr)}${p && p.cost_usd != null && stops ? ` · Charging ${usd(p.cost_usd)}${p.cost_complete === false ? '<small class="ftag">est</small>' : ''}` : ''}${ret != null ? ` · Return ${ret ? 'needs a stop' : 'needs no stop'}` : ''}</div>
      ${p && p.arrival_note ? `<div class="trp-flag">${I(P.warn, 16)}${esc(p.arrival_note)} (target ${pct(p.arrival_target_pct)})</div>` : ''}
      ${tradeLine(d)}
      <div class="trp-map" id="trp-map"></div>
      <div class="trp-src">Route: ${esc(r.source || 'OSRM')} · ${d.temp_f_used != null ? `${d.temp_f_used}°F, ` : ''}${Math.round((d.plan && d.plan.prediction_no_stops && d.plan.prediction_no_stops.wh_mi) || 0)} Wh/mi from your drives · leave ${pct(d.start_soc)}</div>
    </div>`;
  }
  function stopCard(s, i, d) {
    const q = queued(), key = `${(d.dest && d.dest.label) || ''}|${s.charger_id}`;
    const inTrip = plannedHas(s.charger_id);
    const btn = inTrip ? `<span class="trp-in">${I(P.check, 16)}In trip</span>` : q[key] ? `<span class="trp-in q">${I(P.check, 16)}Sent</span>`
      : `<button type="button" class="trp-add" data-add="${i}" aria-label="Add to trip">${I(P.plus, 20)}</button>`;
    const when = s.arrival_time ? new Date(s.arrival_time).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' }) : '';
    const badges = (s.badges || []).map(b => b === 'cheapest' ? `<span class="trp-bdg c">$ Cheapest</span>` : b === 'fastest' ? `<span class="trp-bdg f">› Fastest</span>` : '').join('');
    const short = s.arrival_shortfall_pct ? (s.notes || []).find(n => /short/.test(n)) || `arrives ${pct(s.arrive_soc_pct)}, ${Math.round(s.arrival_shortfall_pct)}% short` : '';
    const meta = [s.is_destination_charge || s.near_destination ? 'near destination' : `mile ${Math.round(s.route_mile)}`, s.network_name || (s.network === 'tesla_supercharger' ? 'Supercharger' : 'NACS'), s.stalls ? `${s.stalls} stalls` : '', s.max_kw ? `${s.max_kw} kW` : ''].filter(Boolean).join(' · ');
    return `<li class="tl-ev trp-stop">
      <span class="tl-node trp-fast" aria-hidden="true">${I(fast(), 16)}</span>
      <div class="tl-time">${esc(when)}${when ? ' · ' : ''}Stop ${i + 1}</div>
      <div class="tl-card trp-scard">
        <div class="trp-shead"><div class="trp-smain"><div class="tl-title">${esc(s.name)}</div><div class="trp-smeta">${esc(meta)}</div></div>${btn}</div>
        <div class="trp-sline"><b>Arrive ${pct(s.arrive_soc_pct)} → ${pct(s.depart_soc_pct)}</b><span>${fmtMin(s.charge_minutes)}</span></div>
        <div class="trp-sline2">avg ${s.effective_kw != null ? Math.round(s.effective_kw) + ' kW' : '–'} · ${priceHtml(s, when)}</div>
        ${short ? `<div class="trp-flag">${I(P.warn, 16)}${esc(short)}</div>` : ''}
        ${badges ? `<div class="trp-bdgs">${badges}</div>` : ''}
      </div></li>`;
  }
  /* v107: prices from Travel Planner. price_source 'provided' = real per-site rate; 'estimated_median_supercharger' = Lei's median
     billed Supercharger rate, always shown with the amber est tag. */
  function priceHtml(s, when) {
    if (s.usd_per_kwh == null) return 'price unknown';
    const est = s.price_source && s.price_source !== 'provided' ? '<small class="ftag">est</small>' : '';
    const rate = `$${(+s.usd_per_kwh).toFixed(s.usd_per_kwh * 100 % 1 ? 3 : 2)}/kWh`;
    return `${rate}${est}${s.cost_usd != null ? ` · ${usd(s.cost_usd)}${est}` : ''}${!est && when ? ' at ' + esc(when) : ''}`;
  }
  function plannedHas(cid) {
    const p = S.meta && S.meta.trips && S.meta.trips.planned;
    return !!(p && Object.values(p.items || {}).some(t => (t.items || []).some(it => it.detail && it.detail.charger_id === cid) || (t.explore_cards || []).some(c => c.in_trip && c.id && c.id.endsWith(cid))));
  }
  function chargingCard(d) {
    const p = curPlan(d), ch = d.chargers || {};
    const tabs = [['balanced', 'Balanced'], ['cheapest', 'Cheapest'], ['fastest', 'Fastest']].map(([k, l]) => `<button type="button" class="auto-cat${T.plan === k ? ' on' : ''}" data-plan="${k}" aria-pressed="${T.plan === k}">${l}</button>`).join('');
    let list;
    if (!p) list = `<div class="trp-empty">No plan</div>`;
    else if (!p.feasible) list = `<div class="trp-empty">${esc(p.reason || 'No workable plan with the chargers found')}</div>`;
    else if (!p.stops.length) list = `<div class="trp-empty">No charging stop in this plan</div>`;
    else list = `<ol class="tl-list trp-stops">${p.stops.map((s, i) => stopCard(s, i, d)).join('')}</ol>`;
    const near = ch.near_destination || [];
    const nearHtml = near.length ? `<button type="button" class="card trp-near" data-act="near" aria-expanded="${T.nearOpen}">${I(fast(), 18)}<span>Near destination (${near.length})</span><span class="trp-nchev${T.nearOpen ? ' open' : ''}">${I(P.chev, 18)}</span></button>
      ${T.nearOpen ? `<div class="card trp-nlist">${near.map(c => `<div class="trp-nrow"><b>${esc(c.name)}</b><small>${c.mi} mi from center · ${esc(c.network_name || 'Supercharger')}${c.stalls ? ` · ${c.stalls} stalls` : ''}${c.max_kw ? ` · ${c.max_kw} kW` : ''}</small></div>`).join('')}</div>` : ''}` : '';
    const nlr = ch.nlr || {};
    const note = nlr.state === 'waiting_key' ? 'Third-party NACS stations: waiting on the NLR station-search key. Superchargers from supercharge.info.'
      : nlr.state === 'error' ? 'Third-party station search failed this time; Superchargers only.' : `Superchargers (supercharge.info) + ${nlr.count} NACS stations (NLR).`;
    const anyEst = Object.values((d.plan && d.plan.plans) || {}).some(pl => (pl.stops || []).some(x => x.price_source && x.price_source !== 'provided'));
    const anyNull = Object.values((d.plan && d.plan.plans) || {}).some(pl => (pl.stops || []).some(x => x.usd_per_kwh == null));
    const priceNote = anyEst ? 'Prices estimated from your median Supercharger rate until per-site rates are added' : anyNull ? 'Some prices are unknown' : 'Prices from per-site rates';
    return `<div class="trp-cats"><span class="trp-cat on">${I(fast(), 18)}Charging</span></div>
      <div class="trp-sec">Charging on the way</div>
      <div class="auto-cats trp-plans" role="tablist">${tabs}</div>
      ${list}${nearHtml}
      <div class="trp-note">${esc(note)} ${esc(priceNote)}; times and battery % are estimates.</div>`;
  }
  function exploreHTML() {
    let body = '';
    if (!ex.dest) body = `<div class="card trp-blank">${I(tripP(), 28)}<b>Pick a destination</b><span>See the weather, the route with arrival battery, and where to charge.</span></div>`;
    else if (T.err === 'auth') body = `<div class="card trp-blank">${I(P.warn, 28)}<b>Remote access is off on this device</b><span>Turn on remote controls in Control once, then come back. Trips uses the same device sign-in.</span></div>`;
    else if (T.err) body = `<div class="card trp-blank">${I(P.warn, 28)}<b>Couldn’t plan this trip</b><span>${esc(T.err)}</span><button type="button" class="pill" data-act="retry">Try again</button></div>`;
    else if (T.busy || !T.data) body = `<div class="card trp-blank"><span class="trp-spin" aria-hidden="true"></span><span>Planning route, weather and charging…</span></div>`;
    else body = weatherCard(T.data) + routeCard(T.data) + chargingCard(T.data);
    return `<div class="trp">${searchCard()}${body}${T.msg ? `<div class="trp-toast">${esc(T.msg)}</div>` : ''}</div>`;
  }
  function ekey() { return ex.dest ? [ex.dest.lat, ex.dest.lon, ex.start, ex.end, ex.depart, ex.soc].join('|') : ''; }
  async function loadExplore(force) {
    const k = ekey(); if (!k) return;
    if (!force && (T.dataKey === k && (T.data || T.busy))) return;
    T.dataKey = k; T.busy = true; T.err = ''; T.data = null;
    const qs = new URLSearchParams({ lat: ex.dest.lat, lon: ex.dest.lon, name: ex.dest.label, start: ex.start, end: ex.end, depart: ex.depart, soc: ex.soc });
    try { const j = await api('/explore?' + qs); if (T.dataKey === k) T.data = j; }
    catch (e) { if (T.dataKey === k) T.err = e.message === 'auth' ? 'auth' : (e.message === 'Failed to fetch' ? 'Couldn’t reach the trip service.' : e.message); }
    finally { if (T.dataKey === k) T.busy = false; }
    if (S.mode === 'trips') renderTrips();
  }
  function drawMap(d) {
    const el = document.getElementById('trp-map'); if (!el || !window.maplibregl || !d.route) return;
    const g = d.route.geometry || []; if (g.length < 2) return;
    const b = new maplibregl.LngLatBounds(g[0], g[0]); g.forEach(c => b.extend(c));
    const m = new maplibregl.Map({ container: el, style: 'https://tiles.openfreemap.org/styles/dark', bounds: b,
      fitBoundsOptions: { padding: 36 }, attributionControl: { compact: true }, cooperativeGestures: true, dragRotate: false, pitchWithRotate: false });
    MAPS.trips = m;
    m.on('load', () => {
      m.addSource('r', { type: 'geojson', data: { type: 'Feature', geometry: { type: 'LineString', coordinates: g } } });
      m.addLayer({ id: 'r', type: 'line', source: 'r', layout: { 'line-cap': 'round', 'line-join': 'round' }, paint: { 'line-color': '#3e8bff', 'line-width': 5, 'line-opacity': .95 } });
    });
    const pin = (c, ring) => (typeof pinEl === 'function' ? pinEl(c, ring) : document.createElement('div'));
    new maplibregl.Marker({ element: pin('#8b94a1', '#22262d') }).setLngLat(g[0]).addTo(m);
    new maplibregl.Marker({ element: pin('#3e8bff', '#152033') }).setLngLat(g[g.length - 1]).addTo(m);
    const p = curPlan(d);
    (p ? p.stops : []).forEach((s, i) => {
      if (s.lat == null) return;
      const e = document.createElement('div'); e.className = 'trp-mpin';
      const bd = (s.badges || []).map(x => x === 'cheapest' ? '$' : x === 'fastest' ? '›' : '').join('');
      e.innerHTML = `<span>${i + 1}</span>${bd ? `<i>${bd}</i>` : ''}`;
      new maplibregl.Marker({ element: e }).setLngLat([s.lon, s.lat]).setPopup(new maplibregl.Popup({ closeButton: false }).setText(s.name)).addTo(m);
    });
  }

  /* ---------- Trip (Upcoming | Past) ---------- */
  function tripsMeta() { return (S.meta && S.meta.trips) || {}; }
  function upcoming() { const p = tripsMeta().planned; return p ? (p.index || []).filter(t => t.status !== 'done').sort((a, b) => a.dates.start.localeCompare(b.dates.start)) : []; }
  function past() {
    const p = tripsMeta().planned, done = p ? (p.index || []).filter(t => t.status === 'done') : [];
    return done.map(t => ({ ...t, planned: true })).concat(tripsMeta().past || []).sort((a, b) => b.dates.start.localeCompare(a.dates.start));
  }
  function rowHTML(t, kind) {
    const right = kind === 'past'
      ? [t.miles != null ? `${Math.round(t.miles)} mi` : '', t.wh_mi ? `${t.wh_mi} Wh/mi` : '', t.stops != null ? `${t.stops} stop${t.stops === 1 ? '' : 's'}` : ''].filter(Boolean).join(' · ')
      : [t.miles != null ? `${Math.round(t.miles)} mi` : '', t.est_cost_usd != null ? `est ${usd(t.est_cost_usd)}` : ''].filter(Boolean).join(' · ');
    return `<button type="button" class="card trp-row" data-trip="${esc(t.id)}" data-kind="${kind}">
      <span class="trp-rnode">${I(tripP(), 18)}</span>
      <span class="trp-rmain"><span class="trp-rdate">${esc(range(t.dates).toUpperCase())}</span><b>${esc(t.title)}</b><small>${esc(right)}</small></span>
      <span class="tl-chev">${I(P.chev, 18)}</span></button>`;
  }
  function listHTML() {
    const tabs = [['upcoming', 'Upcoming'], ['past', 'Past']].map(([k, l]) => `<button type="button" class="auto-cat${T.sub === k ? ' on' : ''}" data-sub="${k}">${l}</button>`).join('');
    let body;
    if (T.sub === 'upcoming') {
      const u = upcoming();
      body = u.length ? u.map(t => rowHTML(t, 'up')).join('') : `<div class="card trp-blank">${I(tripP(), 28)}<b>No upcoming trips</b><span>Pick a destination in Explore and add stops. Travel Planner turns them into a dated trip here.</span><button type="button" class="pill" data-act="toexplore">Explore</button></div>`;
    } else {
      const p = past();
      body = p.length ? `<div class="trp-note">Detected from your drives: leaves home and returns, 150+ mi.</div>` + p.map(t => rowHTML(t, 'past')).join('')
        : `<div class="card trp-blank">${I(tripP(), 28)}<b>No past trips yet</b><span>Road trips show up here after you drive 150+ mi away from home and back.</span></div>`;
    }
    return `<div class="trp"><div class="auto-cats trp-subs" role="tablist">${tabs}</div>${body}</div>`;
  }
  function tile(k, v, u) { return `<div class="trp-tile"><div class="k">${esc(k)}</div><div class="v">${v}${u ? `<small>${esc(u)}</small>` : ''}</div></div>`; }
  function detailHTML() {
    const { id, kind } = T.detail;
    const back = `<button type="button" class="trp-back" data-act="back">${I(P.back, 22)}<span>${kind === 'past' ? 'Past' : 'Upcoming'}</span></button>`;
    if (kind === 'past') {
      const t = past().find(x => x.id === id); if (!t) { T.detail = null; return listHTML(); }
      const tiles = [tile('Miles', Math.round(t.miles), 'mi'), tile('Efficiency', t.wh_mi ?? '–', t.wh_mi ? 'Wh/mi' : ''), tile('Energy used', t.kwh != null ? Math.round(t.kwh) : '–', t.kwh != null ? 'kWh' : ''), tile('Fast-charge stops', t.stops ?? '–')].join('');
      return `<div class="trp">${back}<div class="trp-dt"><b>${esc(t.title)}</b><span>${esc(range(t.dates))} · from Home · ${t.drives || '?'} drives</span></div>
        <div class="trp-tiles">${tiles}</div>
        <div class="card trp-kv">${t.charges != null ? `<div><span>Charging sessions</span><b>${t.charges}</b></div>` : ''}${t.charge_kwh != null ? `<div><span>Energy added</span><b>${t.charge_kwh} kWh</b></div>` : ''}${t.charge_cost != null ? `<div><span>Charging cost</span><b>${usd(t.charge_cost)}</b></div>` : ''}${t.far_mi != null ? `<div><span>Farthest from home</span><b>${t.far_mi} mi</b></div>` : ''}</div>
        <div class="trp-note">Actuals from the tracker's drive and charge log.</div></div>`;
    }
    const p = tripsMeta().planned || {}, t = (p.items || {})[id];
    if (!t) { T.detail = null; return listHTML(); }
    const n = Math.max(1, Math.round((new Date(t.dates.end + 'T12:00') - new Date(t.dates.start + 'T12:00')) / 864e5) + 1);
    const plan = (t.charging_plans || {})[t.plan || 'balanced'] || {};
    const r = t.route || {}, bud = t.budget || {};
    const tiles = [tile(t.round_trip ? 'Round trip' : 'Miles', r.miles != null ? Math.round(r.miles * (t.round_trip ? 2 : 1)) : '–', 'mi'), tile('Stops', r.stops ?? (plan.stops || []).length), tile('Energy', bud.energy != null ? usd(bud.energy) : '–', bud.energy != null ? ' est' : ''), tile('Arrive', r.arrive_soc_pct != null ? Math.round(r.arrive_soc_pct) : '–', r.arrive_soc_pct != null ? '%' : '')].join('');
    const days = n > 1 ? `<div class="auto-cats trp-days">${Array.from({ length: n }, (_, i) => `<button type="button" class="auto-cat${T.day === i + 1 ? ' on' : ''}" data-day1="${i + 1}">Day ${i + 1}</button>`).join('')}</div>` : '';
    const ico = k => k === 'charge' ? fast() : k === 'hotel' ? P.bed : k === 'depart' || k === 'arrive' ? tripP() : P.star;
    const items = (t.items || []).filter(it => (it.day || 1) === T.day);
    const tl = items.length ? `<ol class="tl-list trp-items">${items.map(it => {
      const dt = it.detail || {};
      const sub = it.kind === 'charge' ? `Arrive ${pct(dt.arrive_soc_pct)} → ${pct(dt.depart_soc_pct)} · ${fmtMin(dt.charge_minutes)}` : (dt.soc_pct != null ? `Battery ${pct(dt.soc_pct)}` : '');
      const short = it.kind === 'charge' && dt.arrival_shortfall_pct ? ((dt.notes || []).find(x => /short/.test(x)) || `${Math.round(dt.arrival_shortfall_pct)}% short`) : '';
      return `<li class="tl-ev ${it.kind === 'charge' ? 'trp-stop' : 'trip'}"><span class="tl-node${it.kind === 'charge' ? ' trp-fast' : ''}">${I(ico(it.kind), 16)}</span><div class="tl-time">${esc(it.time || '')}</div>
        <div class="tl-card trp-scard"><div class="tl-title">${esc(it.title)}</div>${sub ? `<div class="trp-smeta">${esc(sub)}</div>` : ''}${short ? `<div class="trp-flag">${I(P.warn, 16)}${esc(short)}</div>` : ''}</div></li>`; }).join('')}</ol>`
      : `<div class="trp-empty">Nothing planned for Day ${T.day} yet</div>`;
    const wx = (t.weather || []).map(w => `<div class="trp-wd"><b>${esc(dlabel(w.date, { weekday: 'short' }))}</b><span class="trp-t">${w.hi != null ? Math.round(w.hi) + '°' : '–'}<small> / ${w.lo != null ? Math.round(w.lo) + '°' : '–'}</small></span></div>`).join('');
    const al = (t.alerts || []).map(a => `<div class="trp-alert">${I(P.warn, 18)}<span><b>${esc(a.event || a.title || 'Alert')}</b></span></div>`).join('');
    return `<div class="trp">${back}<div class="trp-dt"><b>${esc(t.title || t.destination.label)}</b><span>${esc(range(t.dates))} · from Home${t.status === 'live' ? ' · live' : ''}</span></div>
      <div class="trp-tiles">${tiles}</div>
      ${plan.arrival_note ? `<div class="trp-flag">${I(P.warn, 16)}${esc(plan.arrival_note)}</div>` : ''}
      ${al}${wx ? `<div class="card trp-wcard"><div class="trp-wrow">${wx}</div></div>` : ''}
      ${days}${tl}</div>`;
  }

  /* ---------- render + events ---------- */
  window.renderTrips = function () {
    const main = $('#main');
    if (MAPS.trips) { try { MAPS.trips.remove(); } catch (e) {} delete MAPS.trips; }
    const exploreMode = S.mode === 'trips';
    main.innerHTML = exploreMode ? exploreHTML() : (T.detail ? detailHTML() : listHTML());
    if (typeof setModeClass === 'function') setModeClass();
    if (exploreMode) {
      if (T.data && !T.busy) drawMap(T.data);
      else if (ex.dest && !T.err) void loadExplore(false);
      bindInputs();
    }
  };
  let qTimer = null;
  function bindInputs() {
    const q = $('#trp-q');
    if (q) q.oninput = () => {
      T.q = q.value; clearTimeout(qTimer);
      if (T.q.trim().length < 2) { T.results = []; return; }
      qTimer = setTimeout(async () => {
        try { const j = await api('/geocode?q=' + encodeURIComponent(T.q.trim())); T.results = j.results || []; }
        catch (e) { T.results = []; if (e.message === 'auth') { T.err = 'auth'; } }
        const pos = q.selectionStart; renderTrips(); const n = $('#trp-q'); if (n) { n.focus(); try { n.setSelectionRange(pos, pos); } catch (e) {} }
      }, 350);
    };
    const set = (id, k, num) => { const el = $(id); if (el) el.onchange = () => { ex[k] = num ? +el.value : el.value; if (k === 'start' && ex.end < ex.start) ex.end = ex.start; save(); T.data = null; void loadExplore(true); renderTrips(); }; };
    set('#trp-start', 'start'); set('#trp-end', 'end'); set('#trp-dep', 'depart'); set('#trp-soc', 'soc', true);
  }
  function openAdd(i) {
    const p = curPlan(T.data), s = p && p.stops[i]; if (!s) return;
    const n = ndays();
    $('#sheetbody').innerHTML = `<h3 style="margin-top:0">Add to trip</h3><p class="trp-sheetp">${esc(s.name)} · ${esc(T.data.dest.label)}</p>
      <div class="trp-daybtns">${Array.from({ length: n }, (_, k) => `<button type="button" class="pill" data-addday="${k + 1}">Day ${k + 1}<small>${esc(dlabel(iso(new Date(new Date(ex.start + 'T12:00').getTime() + k * 864e5))))}</small></button>`).join('')}</div>
      <p class="trp-sheetp">Travel Planner adds it to the itinerary; the card then shows In trip.</p>
      <button type="button" class="pill trp-cancel" data-addday="0">Cancel</button>`;
    T.addFor = i;
    $('#sheet').classList.remove('hidden');
  }
  async function doAdd(day) {
    const i = T.addFor; T.addFor = null; $('#sheet').classList.add('hidden');
    if (!day) return;
    const d = T.data, s = curPlan(d).stops[i];
    const card = { kind: 'charge', charger_id: s.charger_id, name: s.name, lat: s.lat, lon: s.lon, route_mile: s.route_mile, network: s.network,
      arrive_soc_pct: s.arrive_soc_pct, depart_soc_pct: s.depart_soc_pct, charge_minutes: s.charge_minutes, effective_kw: s.effective_kw,
      usd_per_kwh: s.usd_per_kwh, arrival_time: s.arrival_time, badges: s.badges, arrival_shortfall_pct: s.arrival_shortfall_pct };
    try {
      await api('/add', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ day, plan: T.plan, dest: d.dest, dates: d.dates, card }) });
      const q = queued(); q[`${d.dest.label}|${s.charger_id}`] = Date.now(); try { localStorage.setItem(LSQ, JSON.stringify(q)); } catch (e) {}
      T.msg = `Sent to Travel Planner for Day ${day}`;
    } catch (e) { T.msg = e.message === 'auth' ? 'Turn on remote controls in Control first' : 'Couldn’t add: ' + e.message; }
    renderTrips(); setTimeout(() => { T.msg = ''; if (S.mode === 'trips') { const t = document.querySelector('.trp-toast'); if (t) t.remove(); } }, 3500);
  }
  document.addEventListener('click', e => {
    const b = e.target.closest('#sheet [data-addday]'); if (b) { void doAdd(+b.dataset.addday); }
  });
  window.handleTripsClick = function (e) {
    const t = e.target;
    const pick = t.closest('[data-pick]');
    if (pick) { const r = T.results[+pick.dataset.pick]; if (r) { ex.dest = { label: r.label, lat: r.lat, lon: r.lon }; T.q = ''; T.results = []; save(); T.data = null; T.err = ''; void loadExplore(true); renderTrips(); } return; }
    const act = t.closest('[data-act]');
    if (act) {
      const a = act.dataset.act;
      if (a === 'clear') { ex.dest = null; T.q = ''; T.results = []; T.data = null; T.err = ''; T.dataKey = ''; save(); renderTrips(); }
      else if (a === 'retry') { T.err = ''; void loadExplore(true); renderTrips(); }
      else if (a === 'near') { T.nearOpen = !T.nearOpen; renderTrips(); }
      else if (a === 'back') { T.detail = null; renderTrips(); window.scrollTo(0, 0); }
      else if (a === 'toexplore') goMode('trips');
      return;
    }
    const pl = t.closest('[data-plan]'); if (pl) { T.plan = pl.dataset.plan; renderTrips(); return; }
    const sb = t.closest('[data-sub]'); if (sb) { T.sub = sb.dataset.sub; T.detail = null; renderTrips(); return; }
    const dy = t.closest('[data-day1]'); if (dy) { T.day = +dy.dataset.day1; renderTrips(); return; }
    const ad = t.closest('[data-add]'); if (ad) { openAdd(+ad.dataset.add); return; }
    const row = t.closest('[data-trip]'); if (row) { T.detail = { id: row.dataset.trip, kind: row.dataset.kind }; T.day = 1; renderTrips(); window.scrollTo(0, 0); }
  };
})();
