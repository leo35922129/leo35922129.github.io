/* v106 Trips tab: Explore | Trip. Explore asks the droplet (/api/trips/*, device-token auth, keys stay server-side) for
   route, weather, NWS alerts and Balanced/Cheapest/Fastest charging plans. Trip lists come from the encrypted meta
   (meta.trips.planned from Travel Planner, meta.trips.past detected from the drive log). Nothing here wakes the truck. */
(function () {
  const API = 'https://146-190-255-1.sslip.io/api/trips';
  const LS = 'ht_trips_explore', LSQ = 'ht_trips_queued';
  const T = window.TRIPS_UI = {
    sub: 'upcoming', plan: 'balanced', detail: null, day: 1, q: '', results: [], searching: false,
    data: null, dataKey: '', busy: false, err: '', nearOpen: false, addFor: null, addBusy: false, msg: '',
    cat: 'charge', pl: {}, plBusy: {}, open: null, bars: false,   // v114 Explore categories (Google Places, server-side)
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
    sight: '<path d="M4 20h16M6 20v-8M10 20v-8M14 20v-8M18 20v-8M3.5 12h17L12 5z"/>',
    food: '<path d="M7 3v8M5 3v5a2 2 0 0 0 4 0V3M7 11v10M16.5 21V3c-2.2 1.2-3.5 3.6-3.5 7v4h3.5"/>',
    scenic: '<path d="m2.5 19 6.5-10 4.2 6.2 2.6-3.7 5.7 7.5z"/><circle cx="17" cy="6" r="2"/>',
    event: '<rect x="3.5" y="5" width="17" height="15.5" rx="2.5"/><path d="M3.5 10h17M8 3v4M16 3v4"/><path d="m12 12.6.9 1.9 2 .2-1.5 1.4.4 2-1.8-1-1.8 1 .4-2-1.5-1.4 2-.2z"/>',
    ext: '<path d="M14 4h6v6M20 4l-9 9M18 14v4.5a1.5 1.5 0 0 1-1.5 1.5h-11A1.5 1.5 0 0 1 4 18.5v-11A1.5 1.5 0 0 1 5.5 6H10"/>',
    clock: '<circle cx="12" cy="12" r="8.5"/><path d="M12 7.5V12l3 2"/>',
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
  /* v113: Open-Meteo WMO weather code -> [label, icon key]. Icons use the app's single line-icon style (I()), with light condition tints. */
  const WXK = c => c == null ? null : c === 0 ? ['Clear', 'sun'] : c === 1 ? ['Mostly clear', 'mclear'] : c === 2 ? ['Partly cloudy', 'pcloud']
    : c === 3 ? ['Cloudy', 'cloud'] : c === 45 || c === 48 ? ['Fog', 'fog'] : c >= 51 && c <= 55 ? ['Drizzle', 'drizzle']
    : c === 56 || c === 57 ? ['Freezing drizzle', 'freeze'] : c >= 61 && c <= 65 ? ['Rain', 'rain'] : c === 66 || c === 67 ? ['Freezing rain', 'freeze']
    : c >= 71 && c <= 77 ? ['Snow', 'snow'] : c >= 80 && c <= 82 ? ['Showers', 'shower'] : c === 85 || c === 86 ? ['Snow showers', 'sshower']
    : c >= 95 ? ['Thunderstorm', 'storm'] : ['Weather', 'cloud'];
  const WX = c => (WXK(c) || [''])[0];
  const WXC = 'M7 14h10a3.5 3.5 0 0 0 .4-6.98A5.2 5.2 0 0 0 7.1 6.3 3.9 3.9 0 0 0 7 14z';   // cloud with room for precipitation below
  const WXP = {
    sun: '<circle cx="12" cy="12" r="4"/><path d="M12 2.5v2M12 19.5v2M2.5 12h2M19.5 12h2M5.3 5.3l1.4 1.4M17.3 17.3l1.4 1.4M5.3 18.7l1.4-1.4M17.3 6.7l1.4-1.4"/>',
    mclear: '<circle cx="10" cy="10" r="3.6"/><path d="M10 3v1.6M3 10h1.6M5 5l1.1 1.1M15 5l-1.1 1.1M5 15l1.1-1.1"/><path d="M13.2 20.5h5.6a2.7 2.7 0 0 0 .2-5.4 3.5 3.5 0 0 0-6.5 1.1 2.15 2.15 0 0 0 .7 4.3z"/>',
    pcloud: '<circle cx="8" cy="8" r="3"/><path d="M8 2.6v1.2M2.6 8h1.2M4.2 4.2l.85.85M11.8 4.2l-.85.85M4.2 11.8l.85-.85"/><path d="M10.5 20.5h7.5a3.2 3.2 0 0 0 .35-6.38A4.4 4.4 0 0 0 10 13.4a3.55 3.55 0 0 0 .5 7.1z"/>',
    cloud: '<path d="M7 19h10.5a4 4 0 0 0 .5-7.97A6 6 0 0 0 6.6 10.1 4.5 4.5 0 0 0 7 19z"/>',
    fog: '<path d="' + WXC + '"/><path d="M4 17.5h16M6.5 21h11"/>',
    drizzle: '<path d="' + WXC + '"/><path d="M8.5 17.6v.4M12 17.6v.4M15.5 17.6v.4M10.2 20.6v.4M13.8 20.6v.4"/>',
    rain: '<path d="' + WXC + '"/><path d="M8.6 16.8 7.6 20.4M12.6 16.8l-1 3.6M16.6 16.8l-1 3.6"/>',
    freeze: '<path d="' + WXC + '"/><path d="M8.2 16.8 7.2 20.4M16.8 16.8l-1 3.6"/><path d="M12 16.6v4.4M10.1 17.7l3.8 2.2M13.9 17.7l-3.8 2.2"/>',
    shower: '<path d="' + WXC + '"/><path d="M9.6 16.8l-1 3.6M14.6 16.8l-1 3.6"/>',
    snow: '<path d="' + WXC + '"/><path d="M8.5 16.6v4.2M6.7 17.7l3.6 2M10.3 17.7l-3.6 2M15.5 16.6v4.2M13.7 17.7l3.6 2M17.3 17.7l-3.6 2"/>',
    sshower: '<path d="' + WXC + '"/><path d="M12 16.6v4.2M10.2 17.7l3.6 2M13.8 17.7l-3.6 2"/>',
    storm: '<path d="' + WXC + '"/><path d="M12.8 15.2 10.4 18.6h3.2L11.2 22"/>'
  };
  const WXT = { sun: 'sun', mclear: 'sun', pcloud: 'cloud', cloud: 'cloud', fog: 'cloud', drizzle: 'rain', rain: 'rain', shower: 'rain', freeze: 'rain', snow: 'snow', sshower: 'snow', storm: 'storm' };
  const wxIco = c => { const k = WXK(c); return k ? `<span class="trp-wico wx-${WXT[k[1]]}" title="${k[0]}">${I(WXP[k[1]], 22)}</span>` : ''; };
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
    const days = (w.days || []).map(x => `<div class="trp-wd"><div class="trp-wdh"><b>${esc(dlabel(x.date, { weekday: 'short' }))} ${+x.date.slice(8)}</b>${wxIco(x.code)}</div><span class="trp-wx">${esc(WX(x.code))}</span><span class="trp-t">${x.hi != null ? Math.round(x.hi) + '°' : '–'}<small> / ${x.lo != null ? Math.round(x.lo) + '°' : '–'}</small></span><small>${x.pop != null ? x.pop + '% precip' : ''}${x.wind_mph != null ? ` · ${Math.round(x.wind_mph)} mph` : ''}</small></div>`).join('');
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
    return `<div class="trp-trade">vs ${b.arrival_target_charger_pct ?? b.min_arrive_charger_pct ?? 15}/${b.min_arrive_dest_pct ?? 20}% plan: ${parts.length ? esc(parts.join(' · ')) : 'same stops and time'}</div>`;
  }
  function routeCard(d) {
    const p = curPlan(d), r = d.route || {};
    const stops = p ? p.stops.length : 0;
    const arr = p && p.arrive_soc_pct != null ? p.arrive_soc_pct : d.plan && d.plan.prediction_no_stops && d.plan.prediction_no_stops.arrive_soc_pct;
    const tot = p ? p.total_minutes : r.minutes;
    const ret = d.plan && d.plan.return_needs_stop;
    /* v110: planner's pre-departure home charge (departure on the plan or plan set); info, not a warning */
    const dep = (p && p.departure) || (d.plan && d.plan.departure);
    const depRow = dep && dep.recommended_depart_soc_pct != null && dep.current_soc_pct != null && dep.recommended_depart_soc_pct > dep.current_soc_pct
      ? `<div class="trp-dep">${I(P.home, 16)}<span>${esc(dep.note || `Charge to ${pct(dep.recommended_depart_soc_pct)} at home before leaving`)}${dep.extra_kwh ? ` (+${Math.round(dep.extra_kwh)} kWh${dep.home_cost_usd != null ? ` · home ${usd(dep.home_cost_usd)}` : ''})` : ''}${dep.extra_kwh && dep.home_cost_usd != null ? '<small class="ftag">est</small>' : ''}</span></div>` : '';
    /* v112: Lei's rule (21 Nov): aim ~20% at stops, arrive 80% — read from the plan settings, not hardcoded */
    const st = (d.plan && d.plan.settings) || {};
    const ruleTxt = `Aim ~${Math.round(st.arrival_target_charger_pct ?? st.min_arrive_charger_pct ?? 20)}% at stops, arrive ${Math.round(st.min_arrive_dest_pct ?? 80)}%`;
    const homeCost = dep && dep.home_cost_usd > 0 && p && p.trip_cost_incl_home_usd != null;
    return `<div class="trp-sec">Route</div>
    <div class="card trp-route">
      ${depRow}
      <div class="trp-rline"><b>${Math.round(r.miles)} mi</b><small class="trp-ow">one way</small><span>·</span><b>${fmtMin(tot)}</b><span>·</span><b>${stops} stop${stops === 1 ? '' : 's'}</b><small class="ftag">est</small></div>
      <div class="trp-rsub">Arrive ${pct(arr)}${p && p.cost_usd != null && stops ? ` · ${homeCost ? 'Road charging' : 'Charging'} ${usd(p.cost_usd)}${p.cost_complete === false ? '<small class="ftag">est</small>' : ''}` : ''}${homeCost ? ` · Trip total incl. home ${usd(p.trip_cost_incl_home_usd)}<small class="ftag">est</small>` : ''}${ret != null ? ` · Return ${ret ? 'needs a stop' : 'needs no stop'}` : ''}</div>
      ${p && p.arrival_note ? `<div class="trp-flag">${I(P.warn, 16)}${esc(p.arrival_note)} (target ${pct(p.arrival_target_pct)})</div>` : ''}
      <div class="trp-rule">${esc(ruleTxt)}</div>
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
    const meta = [s.is_destination_charge || s.near_destination ? 'near destination' : `mile ${Math.round(s.route_mile)}`, netName(s.network_name) || (s.network === 'tesla_supercharger' ? 'Tesla Supercharger' : 'NACS'), s.stalls ? plural(s.stalls, 'stall') : '', s.max_kw ? `max ${s.max_kw} kW` : ''].filter(Boolean).join(' · ');
    const kwEst = s.kw_source === 'estimated' ? '<small class="ftag">est</small>' : '';  // v109: planner assumed the site kW
    return `<li class="tl-ev trp-stop">
      <span class="tl-node trp-fast" aria-hidden="true">${I(fast(), 16)}</span>
      <div class="tl-time">${esc(when)}${when ? ' · ' : ''}Stop ${i + 1}</div>
      <div class="tl-card trp-scard">
        <div class="trp-shead"><div class="trp-smain"><div class="tl-title">${esc(s.name)}</div><div class="trp-smeta">${esc(meta)}${s.max_kw ? kwEst : ''}</div></div>${btn}</div>
        <div class="trp-sline"><b>Arrive ${pct(s.arrive_soc_pct)} → ${pct(s.depart_soc_pct)}</b><span>${fmtMin(s.charge_minutes)}</span></div>
        <div class="trp-sline2">avg ${s.effective_kw != null ? Math.round(s.effective_kw) + ' kW' + kwEst : '–'} · ${priceHtml(s, when)}</div>
        ${short ? `<div class="trp-flag">${I(P.warn, 16)}${esc(short)}</div>` : ''}
        ${badges ? `<div class="trp-bdgs">${badges}</div>` : ''}
      </div></li>`;
  }
  /* v107: prices from Travel Planner. price_source 'provided' = real per-site rate; 'estimated_median_supercharger' = Lei's median
     billed Supercharger rate, always shown with the amber est tag. */
  /* v108: friendly network names for raw NLR ev_network codes + correct plurals */
  const NETS = { RED_E: 'RED E', RIVIAN_ADVENTURE: 'Rivian Adventure Network', RIVIAN_WAYPOINTS: 'Rivian Waypoints', 'Non-Networked': 'Independent',
    CHARGEPOINT: 'ChargePoint', 'ChargePoint Network': 'ChargePoint', 'Blink Network': 'Blink', BLINK: 'Blink', EVGO: 'EVgo', 'eVgo Network': 'EVgo',
    'Electrify America': 'Electrify America', ELECTRIFYAMERICA: 'Electrify America', EVCONNECT: 'EV Connect', 'EV Connect': 'EV Connect',
    SHELL_RECHARGE: 'Shell Recharge', 'SHELL_RECHARGE': 'Shell Recharge', BPPULSE: 'bp pulse', 'BP_PULSE': 'bp pulse', IONNA: 'IONNA',
    FLO: 'FLO', CIRCLE_K: 'Circle K', 'CIRCLE_K': 'Circle K', 'Circle K': 'Circle K', FCN: 'Francis Energy', FRANCIS: 'Francis Energy', 'FRANCIS_ENERGY': 'Francis Energy',
    MERCEDES_BENZ: 'Mercedes-Benz High-Power Charging', 'MERCEDES-BENZ': 'Mercedes-Benz High-Power Charging', WALMART: 'Walmart', PILOT: 'Pilot Flying J',
    'PILOT-FLYING-J': 'Pilot Flying J', ZEFNET: 'Zef Energy', 'Volta': 'Volta', 'Tesla': 'Tesla Supercharger', 'Tesla Destination': 'Tesla Destination', SEVEN_ELEVEN: '7-Eleven',
    '7CHARGE': '7Charge', LOOP: 'Loop', NOODOE: 'Noodoe', POWERFLEX: 'PowerFlex', CHARGELAB: 'ChargeLab', SWTCH: 'SWTCH', AMPUP: 'AmpUp', UNIVERSAL: 'Universal EV Charging' };
  function netName(n) {
    if (!n) return '';
    if (NETS[n]) return NETS[n];
    if (/[a-z]/.test(n) && !/_/.test(n)) return n;  // already human-readable
    return n.replace(/[_]+/g, ' ').toLowerCase().replace(/\b[a-z]/g, c => c.toUpperCase());
  }
  const plural = (n, w, ws) => `${n} ${+n === 1 ? w : (ws || w + 's')}`;
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
      ${T.nearOpen ? `<div class="card trp-nlist">${near.map(c => `<div class="trp-nrow"><b>${esc(c.name)}</b><small>${c.mi} mi from center · ${esc(netName(c.network_name) || 'Tesla Supercharger')}${c.stalls ? ` · ${plural(c.stalls, 'stall')}` : ''}${c.max_kw ? ` · ${c.max_kw} kW` : ''}</small></div>`).join('')}</div>` : ''}` : '';
    const nlr = ch.nlr || {};
    const note = nlr.state === 'waiting_key' ? 'Third-party NACS stations: waiting on the NLR station-search key. Superchargers from supercharge.info.'
      : nlr.state === 'error' ? 'Third-party station search failed this time; Superchargers only.' : `Superchargers (supercharge.info) + ${plural(nlr.count, 'NACS station')} (NLR).`;
    const anyEst = Object.values((d.plan && d.plan.plans) || {}).some(pl => (pl.stops || []).some(x => x.price_source && x.price_source !== 'provided'));
    const anyNull = Object.values((d.plan && d.plan.plans) || {}).some(pl => (pl.stops || []).some(x => x.usd_per_kwh == null));
    const priceNote = anyEst ? 'Prices estimated from your median Supercharger rate until per-site rates are added' : anyNull ? 'Some prices are unknown' : 'Prices from per-site rates';
    return `<div class="trp-sec">Charging on the way</div>
      <div class="auto-cats trp-plans" role="tablist">${tabs}</div>
      ${list}${nearHtml}
      <div class="trp-note">${esc(note)} ${esc(priceNote)}; times and battery % are estimates.</div>`;
  }

  /* v114: Explore categories. Places come from the droplet (/api/trips/places), which calls Google Places API (New)
     server-side with a 100/day cap and a 7-day cache. No key, photo or Google request ever reaches the browser. */
  const CATS = [['charge', 'Charging', null], ['sights', 'Sights', 'sight'], ['food', 'Food', 'food'], ['scenic', 'Scenic', 'scenic'], ['events', 'Events', 'event']];
  const CAT_SEC = { sights: 'Things to see', food: 'Restaurants', scenic: 'Scenic stops', events: 'Events' };
  function catsHTML() {
    return `<div class="trp-cats" role="tablist">${CATS.map(([k, l, ic]) => `<button type="button" class="trp-cat c-${k}${T.cat === k ? ' on' : ''}" data-cat="${k}" role="tab" aria-selected="${T.cat === k}">${I(ic ? P[ic] : fast(), 20)}<span>${l}</span></button>`).join('')}</div>`;
  }
  const pkey = cat => ex.dest ? `${cat}|${(+ex.dest.lat).toFixed(3)},${(+ex.dest.lon).toFixed(3)}` : '';
  async function loadPlaces(cat) {
    const k = pkey(cat); if (!k || T.pl[k] || T.plBusy[k]) return;
    T.plBusy[k] = true;
    try { T.pl[k] = await api('/places?' + new URLSearchParams({ cat, lat: ex.dest.lat, lon: ex.dest.lon, name: ex.dest.label })); }
    catch (e) { T.pl[k] = { state: e.message === 'auth' ? 'auth' : 'error', error: e.message, items: [] }; }
    finally { delete T.plBusy[k]; }
    if (S.mode === 'trips' && T.cat === cat) renderTrips();
  }
  const fmtN = n => n == null ? '' : n >= 10000 ? `${Math.round(n / 1000)}k` : n.toLocaleString('en-US');
  const placeIn = it => { const p = S.meta && S.meta.trips && S.meta.trips.planned;
    return !!(p && Object.values(p.items || {}).some(t => (t.items || []).some(x => x.detail && x.detail.place_id === it.place_id))); };
  function shownPlaces(r, cat) {
    const all = (r && r.items) || [];
    return cat === 'food' && !T.bars ? all.filter(x => !x.bar) : all;
  }
  function placeCard(it, i, cat) {
    const q = queued(), qk = `${(ex.dest && ex.dest.label) || ''}|${it.place_id}`;
    const btn = placeIn(it) ? `<span class="trp-in">${I(P.check, 16)}In trip</span>` : q[qk] ? `<span class="trp-in q">${I(P.check, 16)}Sent</span>`
      : `<button type="button" class="trp-add" data-padd="${i}" aria-label="Add ${esc(it.title)} to trip">${I(P.plus, 20)}</button>`;
    const rating = it.rating != null ? `<span class="trp-rate">${I(P.star, 13)}${(+it.rating).toFixed(1)}</span>${it.rating_count ? `<span class="trp-cnt">(${fmtN(it.rating_count)})</span>` : ''}` : '';
    const open = it.open_now === true ? '<span class="trp-open">Open now</span>' : it.open_now === false ? '<span class="trp-closed">Closed now</span>' : '';
    const where = it.where === 'route' && it.route_mile != null ? `mile ${it.route_mile} on route` : it.mi_from_dest != null ? `${it.mi_from_dest < 0.15 ? '<0.1' : it.mi_from_dest} mi away` : '';
    const meta = [rating, it.price_level ? esc(it.price_level) : '', open, esc(where)].filter(Boolean).join('<i>·</i>');
    const isOpen = T.open === it.id;
    let more = '';
    if (isOpen) {
      const dow = new Date(ex.start + 'T12:00').getDay(), hrs = (it.hours || [])[(dow + 6) % 7];
      more = `<div class="trp-pmore">
        ${it.address ? `<div class="trp-prow">${I(P.pin, 16)}<span>${esc(it.address)}</span></div>` : ''}
        ${hrs ? `<div class="trp-prow">${I(P.clock, 16)}<span>${esc(hrs.replace(/\u2009|\u202f/g, ' '))}<small> (trip day)</small></span></div>` : ''}
        ${it.where === 'route' && it.off_route_mi != null ? `<div class="trp-prow">${I(tripP(), 16)}<span>${it.off_route_mi} mi off the route at mile ${it.route_mile}</span></div>` : ''}
        <div class="trp-pbtns">${it.maps_url ? `<a class="pill" href="${esc(it.maps_url)}" target="_blank" rel="noopener">${I(P.ext, 16)}Google Maps</a>` : ''}${btn.includes('data-padd') ? `<button type="button" class="pill acc" data-padd="${i}">${I(P.plus, 16)}Add to trip</button>` : ''}</div>
      </div>`;
    }
    return `<div class="card trp-pcard${isOpen ? ' open' : ''}" data-popen="${esc(it.id)}" role="button" tabindex="0" aria-expanded="${isOpen}">
      <div class="trp-phead"><div class="trp-smain"><div class="trp-ptitle">${esc(it.title)}</div><div class="trp-psub">${esc(it.subtitle || '')}</div><div class="trp-pmeta">${meta}</div></div>${btn}</div>${more}</div>`;
  }
  function placesHTML(cat) {
    const sec = `<div class="trp-sec">${esc(CAT_SEC[cat])}${ex.dest ? ' · ' + esc(ex.dest.label.split(',')[0]) : ''}</div>`;
    if (cat === 'events') return sec + `<div class="card trp-blank">${I(P.event, 28)}<b>Events are coming soon</b><span>Google Places doesn’t list events, and there’s no free event source without another key yet. Nothing is shown rather than guessed.</span></div>`;
    const k = pkey(cat), r = T.pl[k];
    if (!r) { void loadPlaces(cat); return sec + `<div class="card trp-blank"><span class="trp-spin" aria-hidden="true"></span><span>Looking up places…</span></div>`; }
    if (r.state === 'auth') return sec + `<div class="card trp-blank">${I(P.warn, 28)}<b>Remote access is off on this device</b><span>Turn on remote controls in Control once, then come back.</span></div>`;
    if (r.state === 'error') return sec + `<div class="card trp-blank">${I(P.warn, 28)}<b>Couldn’t look up places</b><span>${esc(r.error || '')}</span><button type="button" class="pill" data-act="pretry">Try again</button></div>`;
    if (r.state === 'limit') return sec + `<div class="card trp-blank">${I(P.clock, 28)}<b>Daily limit reached</b><span>Place lookups are capped at ${r.usage ? r.usage.day_cap : 100} a day to stay inside Google’s free tier. Places you already opened still show. Try again tomorrow.</span></div>`;
    if (r.state === 'no_key') return sec + `<div class="card trp-blank">${I(P.warn, 28)}<b>Places aren’t set up</b><span>The Google Places key isn’t installed on the server.</span></div>`;
    const list = shownPlaces(r, cat), hidden = (r.items || []).length - list.length;
    const filt = cat === 'food' ? `<div class="trp-pfilt"><span>${I(P.star, 14)}4.3+${T.bars ? '' : ' · no bars'}</span><button type="button" class="trp-tog${T.bars ? ' on' : ''}" data-act="bars" aria-pressed="${T.bars}">${T.bars ? 'Hide bars' : `Include bars${hidden ? ` (${hidden})` : ''}`}</button></div>` : '';
    const body = list.length ? `<div class="trp-plist">${list.map((it, i) => placeCard(it, i, cat)).join('')}</div>` : `<div class="trp-empty">Nothing found near here</div>`;
    const u = r.usage || {};
    const note = [r.note, r.state === 'partial_limit' ? 'Daily lookup limit reached, so this list may be incomplete.' : '',
      `Places data from Google Maps, refreshed weekly. ${u.today != null ? `${u.today} of ${u.day_cap} lookups used today.` : ''} Open now is right now, not on the trip day.`].filter(Boolean).join(' ');
    return sec + filt + body + `<div class="trp-note">${esc(note)}</div>`;
  }
  function exploreHTML() {
    let body = '';
    if (!ex.dest) body = `<div class="card trp-blank">${I(tripP(), 28)}<b>Pick a destination</b><span>See the weather, the route with arrival battery, and where to charge.</span></div>`;
    else if (T.err === 'auth') body = `<div class="card trp-blank">${I(P.warn, 28)}<b>Remote access is off on this device</b><span>Turn on remote controls in Control once, then come back. Trips uses the same device sign-in.</span></div>`;
    else if (T.err) body = `<div class="card trp-blank">${I(P.warn, 28)}<b>Couldn’t plan this trip</b><span>${esc(T.err)}</span><button type="button" class="pill" data-act="retry">Try again</button></div>`;
    else if (T.busy || !T.data) body = `<div class="card trp-blank"><span class="trp-spin" aria-hidden="true"></span><span>Planning route, weather and charging…</span></div>`;
    else body = weatherCard(T.data) + routeCard(T.data) + catsHTML() + (T.cat === 'charge' ? chargingCard(T.data) : placesHTML(T.cat));
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
      ? [t.miles != null ? `${Math.round(t.miles)} mi` : '', t.wh_mi ? `${t.wh_mi} Wh/mi` : '', t.stops != null ? plural(t.stops, 'stop') : ''].filter(Boolean).join(' · ')
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
  function openAdd(i, place) {
    const p = curPlan(T.data), s = place || (p && p.stops[i]); if (!s) return;
    const n = ndays();
    $('#sheetbody').innerHTML = `<h3 style="margin-top:0">Add to trip</h3><p class="trp-sheetp">${esc(s.name || s.title)} · ${esc(T.data.dest.label)}</p>
      <div class="trp-daybtns">${Array.from({ length: n }, (_, k) => `<button type="button" class="pill" data-addday="${k + 1}">Day ${k + 1}<small>${esc(dlabel(iso(new Date(new Date(ex.start + 'T12:00').getTime() + k * 864e5))))}</small></button>`).join('')}</div>
      <p class="trp-sheetp">Travel Planner adds it to the itinerary; the card then shows In trip.</p>
      <button type="button" class="pill trp-cancel" data-addday="0">Cancel</button>`;
    T.addFor = place ? { place } : i;
    $('#sheet').classList.remove('hidden');
  }
  async function doAdd(day) {
    const i = T.addFor; T.addFor = null; $('#sheet').classList.add('hidden');
    if (!day || i == null) return;
    const d = T.data;
    if (i && i.place) {   // v114: Google Places card -> same trips inbox flow
      const it = i.place;
      const card = { kind: it.kind, name: it.title, place_id: it.place_id, category: it.category, subtitle: it.subtitle, primary_type: it.primary_type,
        lat: it.lat, lon: it.lon, address: it.address, rating: it.rating, rating_count: it.rating_count, price_level: it.price_level,
        maps_url: it.maps_url, route_mile: it.route_mile ?? null, mi_from_dest: it.mi_from_dest ?? null, source: 'google_places' };
      try {
        await api('/add', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ day, plan: T.plan, dest: d.dest, dates: d.dates, card }) });
        const q = queued(); q[`${d.dest.label}|${it.place_id}`] = Date.now(); try { localStorage.setItem(LSQ, JSON.stringify(q)); } catch (e) {}
        T.msg = `Sent to Travel Planner for Day ${day}`;
      } catch (e) { T.msg = e.message === 'auth' ? 'Turn on remote controls in Control first' : 'Couldn’t add: ' + e.message; }
      renderTrips(); setTimeout(() => { T.msg = ''; if (S.mode === 'trips') { const t = document.querySelector('.trp-toast'); if (t) t.remove(); } }, 3500);
      return;
    }
    const s = curPlan(d).stops[i];
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
      else if (a === 'bars') { T.bars = !T.bars; T.open = null; renderTrips(); }
      else if (a === 'pretry') { delete T.pl[pkey(T.cat)]; renderTrips(); }
      return;
    }
    const pl = t.closest('[data-plan]'); if (pl) { T.plan = pl.dataset.plan; renderTrips(); return; }
    const ct = t.closest('[data-cat]'); if (ct) { if (T.cat !== ct.dataset.cat) { T.cat = ct.dataset.cat; T.open = null; renderTrips(); } return; }
    const pa = t.closest('[data-padd]'); if (pa) { const r = T.pl[pkey(T.cat)], it = shownPlaces(r, T.cat)[+pa.dataset.padd]; if (it) openAdd(null, it); return; }
    if (t.closest('.trp-pmore a')) return;
    const po = t.closest('[data-popen]'); if (po) { T.open = T.open === po.dataset.popen ? null : po.dataset.popen; renderTrips(); return; }
    const sb = t.closest('[data-sub]'); if (sb) { T.sub = sb.dataset.sub; T.detail = null; renderTrips(); return; }
    const dy = t.closest('[data-day1]'); if (dy) { T.day = +dy.dataset.day1; renderTrips(); return; }
    const ad = t.closest('[data-add]'); if (ad) { openAdd(+ad.dataset.add); return; }
    const row = t.closest('[data-trip]'); if (row) { T.detail = { id: row.dataset.trip, kind: row.dataset.kind }; T.day = 1; renderTrips(); window.scrollTo(0, 0); }
  };
})();
