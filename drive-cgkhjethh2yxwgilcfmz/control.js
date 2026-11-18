/* Control + Software UI. Commands go to the droplet API. No tokens or PINs in this file. */
'use strict';
const CONTROL = {
  view: 'home',          // home | software | software-detail
  detail: null,
  notes: null,
  waking: false,
  wakeLabel: 'Waking truck…',
  confirm: null,         // {id, title, word, go, body, cmd}
  st: null,
  busy: false,
  result: null           // {ok, text}
};
const CTL_API = 'https://146-190-255-1.sslip.io/control';
const CTL_TOKEN_KEY = 'ht_control_token';

const ctlIco = (d, box='0 0 24 24') =>
  `<svg viewBox="${box}" width="18" height="18" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">${d}</svg>`;
const ICONS = {
  climate: ctlIco('<path d="M12 3v6M8 6.5 12 9l4-2.5"/><circle cx="12" cy="15.5" r="5.5"/>'),
  lock: ctlIco('<rect x="5" y="11" width="14" height="10" rx="2"/><path d="M8 11V8a4 4 0 0 1 8 0v3"/>'),
  unlock: ctlIco('<rect x="5" y="11" width="14" height="10" rx="2"/><path d="M8 11V8a4 4 0 0 1 7.5-2"/>'),
  sentry: ctlIco('<path d="M12 4 5 7v5c0 4.2 3 7.2 7 8.5 4-1.3 7-4.3 7-8.5V7z"/><circle cx="12" cy="12" r="2"/>'),
  bolt: ctlIco('<path d="m11 3-6 10h6l-1 8 7-11h-6z"/>'),
  port: ctlIco('<rect x="7" y="4" width="10" height="14" rx="2"/><path d="M9 18v2h6v-2"/>'),
  defrost: ctlIco('<path d="M5 19h14M7 16c2-4 4-9 5-13 1 4 3 9 5 13"/><path d="M9 10h.01M15 12h.01"/>'),
  seat: ctlIco('<path d="M7 14V8a3 3 0 0 1 6 0v6"/><path d="M6 18h12M8 14h8v4H8z"/>'),
  wheel: ctlIco('<circle cx="12" cy="12" r="7"/><circle cx="12" cy="12" r="2"/><path d="M12 5v5M7.2 15.5 10 13M16.8 15.5 14 13"/>'),
  honk: ctlIco('<path d="M4 10v4h3l4 3V7L7 10H4z"/><path d="M16 9a4 4 0 0 1 0 6M18.5 7a7 7 0 0 1 0 10"/>'),
  flash: ctlIco('<path d="M8 12a5 5 0 0 1 8 0M5.5 9.5a8 8 0 0 1 13 0M12 16v.01"/><circle cx="12" cy="19" r="1"/>'),
  window: ctlIco('<rect x="5" y="4" width="14" height="16" rx="2"/><path d="M5 10h14"/>'),
  tonneau: ctlIco('<path d="M4 15h16v3H4z"/><path d="M5 15V9h14v6"/>'),
  media: ctlIco('<circle cx="8" cy="16" r="2.5"/><circle cx="17" cy="14" r="2.5"/><path d="M10.5 16V7l9-2v9"/>'),
  wake: ctlIco('<path d="M12 4v4M12 16v4M4 12h4M16 12h4M6.5 6.5l2.5 2.5M15 15l2.5 2.5M17.5 6.5 15 9M9 15l-2.5 2.5"/>'),
  frunk: ctlIco('<path d="M5 14h14l-1.5 5h-11z"/><path d="M7 14V9l5-3 5 3v5"/>'),
  trunk: ctlIco('<path d="M4 15h16v4H4z"/><path d="M6 15V10h12v5"/>'),
  start: ctlIco('<circle cx="12" cy="12" r="8"/><path d="m10 9 6 3-6 3z"/>'),
  chev: ctlIco('<path d="m9 6 6 6-6 6"/>'),
  cabin: ctlIco('<path d="M10 13.2V7a2 2 0 1 1 4 0v6.2a3.2 3.2 0 1 1-4 0z"/><path d="M12 8.5v6"/>'),
  software: ctlIco('<rect x="5" y="6" width="14" height="12" rx="2"/><path d="M8 10h8M8 14h5"/>')
};

function ctlEsc(s){ return String(s ?? '').replace(/[&<>"]/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c])); }
function blank(v){ return v ? ctlEsc(v) : '<span class="sw-blank">Not recorded</span>'; }
function loadNotes(){
  const sw = controlMeta().software || {};
  CONTROL.notes = {by_version: sw.by_version || {}};
  return Promise.resolve(CONTROL.notes);
}

function dash(v){ return (v === null || v === undefined || v === '') ? '—' : v; }
function controlMeta(){
  const m = (typeof S !== 'undefined' && S.meta) ? S.meta : {};
  return { status: m.control || {}, software: m.software || {} };
}
function initControlState(){
  const {status} = controlMeta();
  CONTROL.st = Object.assign({}, status);
  CONTROL.notes = (controlMeta().software || {}).by_version ? {by_version: controlMeta().software.by_version} : {by_version: (controlMeta().software || {}).by_version || {}};
}

function setControlChrome(){
  const app = document.getElementById('app');
  if (!app) return;
  const on = (typeof S !== 'undefined' && S.mode === 'control');
  app.classList.toggle('mode-control', !!on);
  const head = document.getElementById('ctlhead');
  if (head) head.classList.toggle('hidden', !on);
  const back = document.getElementById('ctlback');
  const title = document.getElementById('ctltitle');
  const sub = CONTROL.view !== 'home';
  if (back) back.classList.toggle('hidden', !on || !sub);
  if (head) head.classList.toggle('is-sub', !!sub);
  if (title) title.textContent = CONTROL.view === 'home' ? 'Control' : 'Software';
}

function renderControl(){
  CONTROL.st = null;
  initControlState();
  setControlChrome();
  const main = document.getElementById('main');
  if (!main) return;
  if (CONTROL.view === 'software' || CONTROL.view === 'software-detail') {
    loadNotes().then(() => { if (S.mode === 'control') paintSoftware(main); });
    paintSoftware(main);
    return;
  }
  paintControlHome(main);
}

function paintControlHome(main){
  const st = CONTROL.st || {};
  const driving = st.gear && st.gear !== 'P' && st.gear !== 'N';
  const parked = st.gear === 'P';
  const driveLabel = driving ? `Driving · ${dash(st.speed_mph)} mph` : (parked ? 'Parked' : (st.gear ? ctlEsc(st.gear) : '—'));
  const clim = st.climate_on == null ? '—' : (st.climate_on ? `On · ${dash(st.set_temp_f)}°` : 'Off');
  const charge = st.plugged_in == null && !st.charging_state ? '—' : (st.plugged_in ? dash(st.charging_state || 'Plugged in') : 'Unplugged');
  const live = st.last_seen_et ? `Live ${ctlEsc(st.last_seen_et)}` : 'Live —';
  const srcParts = [];
  if (st.last_seen_et) srcParts.push('Live ' + st.last_seen_et);
  if (st.tessie_et) srcParts.push('Tessie ' + st.tessie_et);
  const srcLine = srcParts.length ? srcParts.join(' · ') : 'Status unavailable';
  const cabin = (st.cabin_f == null && st.outside_f == null) ? '—' : `${dash(st.cabin_f)}° / ${dash(st.outside_f)}°`;
  const doors = st.locked == null ? '—' : (st.locked ? 'Locked' : 'Unlocked');
  const sentry = st.sentry == null ? '—' : (st.sentry ? 'On' : 'Off');
  const swVer = dash(st.software_version);
  main.innerHTML = `
    <section class="ctl-status">
      <div class="ctl-status-top">
        <span class="ctl-pill${driving ? ' drive' : ''}">${driveLabel}</span>
        <span class="ctl-live"><i></i>${live}</span>
      </div>
      <div class="ctl-hero">
        <div><div class="n">${st.battery_pct == null ? '—' : st.battery_pct}${st.battery_pct == null ? '' : '<small>%</small>'}</div><div class="k">Battery</div></div>
        <div><div class="n">${st.rated_range_mi == null ? '—' : st.rated_range_mi}${st.rated_range_mi == null ? '' : '<small> mi</small>'}</div><div class="k">Rated range</div></div>
      </div>
      <div class="ctl-chips">
        <div class="ctl-chip${st.locked === false ? ' alert' : ''}">
          <span class="ic">${ICONS.lock}</span>
          <span class="k">Doors</span>
          <span class="v">${doors}</span>
        </div>
        <div class="ctl-chip${st.climate_on ? ' on' : ''}">
          <span class="ic">${ICONS.climate}</span>
          <span class="k">Climate</span>
          <span class="v">${clim}</span>
        </div>
        <div class="ctl-chip">
          <span class="ic">${ICONS.cabin}</span>
          <span class="k">Cabin / out</span>
          <span class="v">${cabin}</span>
        </div>
        <div class="ctl-chip">
          <span class="ic">${ICONS.bolt}</span>
          <span class="k">Charging</span>
          <span class="v">${typeof charge === 'string' ? ctlEsc(charge) : '—'}</span>
        </div>
        <div class="ctl-chip${st.sentry ? ' on' : ''}">
          <span class="ic">${ICONS.sentry}</span>
          <span class="k">Sentry</span>
          <span class="v">${sentry}</span>
        </div>
        <button type="button" class="ctl-chip nav" data-act="open-software" aria-label="Open software ${ctlEsc(String(swVer))}">
          <span class="ic">${ICONS.software}</span>
          <span class="k">Software</span>
          <span class="v">${ctlEsc(String(swVer))}<span class="ctl-chev">${ICONS.chev}</span></span>
        </button>
      </div>
      <p class="ctl-src">${ctlEsc(srcLine)}</p>
    </section>

    <div class="ctl-sec">Quick controls</div>
    ${CONTROL.result ? `<p class="ctl-result${CONTROL.result.ok ? ' ok' : ' err'}">${ctlEsc(CONTROL.result.text)}</p>` : ''}
    <div class="ctl-grid">
      ${wideClimate(st)}
      ${btn('lock', 'Lock', st.locked == null ? '—' : (st.locked ? 'Locked' : 'Unlocked'), ICONS.lock, !!st.locked)}
      ${btn('sentry', 'Sentry', st.sentry == null ? '—' : (st.sentry ? 'On' : 'Off'), ICONS.sentry, !!st.sentry)}
      ${wideCharge(st)}
      ${btn('defrost', 'Defrost', st.defrost == null ? '—' : (st.defrost ? 'On' : 'Off'), ICONS.defrost, !!st.defrost)}
      ${btn('seat-l', 'Driver seat', heatLabel(st.seat_heater_left), ICONS.seat, st.seat_heater_left>0)}
      ${btn('seat-r', 'Passenger seat', heatLabel(st.seat_heater_right), ICONS.seat, st.seat_heater_right>0)}
      ${btn('wheel', 'Steering heat', st.steering_heat ? 'On' : 'Off', ICONS.wheel, st.steering_heat)}
      ${btn('honk', 'Honk', 'Horn', ICONS.honk, false)}
      ${btn('flash', 'Flash lights', 'Lights', ICONS.flash, false)}
      ${btn('windows-close', 'Close windows', st.windows_closed == null ? '—' : (st.windows_closed ? 'Closed' : 'Open'), ICONS.window, !!st.windows_closed)}
      ${btn('tonneau-close', 'Close tonneau', st.tonneau === 'closed' ? 'Closed' : st.tonneau, ICONS.tonneau, st.tonneau==='closed')}
      ${btn('port', 'Charge port', st.charge_port_open == null ? '—' : (st.charge_port_open ? 'Open' : 'Closed'), ICONS.port, !!st.charge_port_open)}
      ${btn('media', 'Media', 'Not recorded', ICONS.media, false)}
      ${btn('wake', 'Wake', st.vehicle_state ? (st.vehicle_state === 'online' ? 'Online' : ctlEsc(st.vehicle_state)) : '—', ICONS.wake, st.vehicle_state==='online')}
    </div>

    <div class="ctl-sec risk">Needs confirm</div>
    <p class="ctl-soon">These require a typed confirm and your PIN each time.</p>
    <div class="ctl-risk">
      ${rbtn('unlock', 'Unlock', 'Type UNLOCK and your PIN', ICONS.unlock)}
      ${rbtn('tonneau-open', 'Open tonneau', 'Type OPEN and your PIN', ICONS.tonneau)}
      ${rbtn('frunk', 'Open frunk', 'There is no frunk close · type FRUNK and your PIN', ICONS.frunk)}
      ${rbtn('trunk', 'Open trunk', 'Type TRUNK and your PIN', ICONS.trunk)}
      ${rbtn('windows-vent', 'Vent windows', 'Type VENT and your PIN', ICONS.window)}
    </div>

    <div class="ctl-sec">Automations</div>
    <div class="ctl-auto" id="ctl-auto"></div>
    <button type="button" class="ctl-link" data-act="goto-auto">Manage in the Automation tab</button>
  `;
  paintEmbeddedAutos();
  if (CONTROL.waking) paintWake();
  if (CONTROL.confirm) paintConfirm();
}

function heatLabel(n){ return n ? ['Off','Low','Med','High'][n] || String(n) : 'Off'; }
function btn(id, name, st, icon, on){
  return `<button type="button" class="ctl-btn${on?' on':''}" data-act="${id}"${CONTROL.busy?' disabled':''}><span class="ic">${icon}</span><span class="nm">${name}</span><span class="st">${ctlEsc(dash(st))}</span></button>`;
}
function rbtn(id, name, st, icon){
  return `<button type="button" class="ctl-rbtn" data-act="${id}"${CONTROL.busy?' disabled':''}><span class="ic">${icon}</span><span><div class="nm">${name}</div><div class="st">${ctlEsc(st)}</div></span></button>`;
}
function wideClimate(st){
  const onoff = st.climate_on == null ? '—' : (st.climate_on ? 'On' : 'Off');
  return `<div class="ctl-btn wide ${st.climate_on?'on':''}">
    <span class="ic">${ICONS.climate}</span>
    <div class="grow"><div class="nm">Climate</div><div class="st">${onoff} · cabin ${st.cabin_f == null ? '—' : st.cabin_f + '°F'}</div></div>
    <div class="ctl-actions">
      <div class="ctl-step">
        <button type="button" data-act="temp-down" aria-label="Lower temperature"${CONTROL.busy?' disabled':''}>−</button>
        <span class="v">${st.set_temp_f == null ? '—' : st.set_temp_f + '°'}</span>
        <button type="button" data-act="temp-up" aria-label="Raise temperature"${CONTROL.busy?' disabled':''}>+</button>
      </div>
      <button type="button" class="ctl-mini" data-act="climate"${CONTROL.busy?' disabled':''}>${st.climate_on?'Turn off':'Turn on'}</button>
    </div>
  </div>`;
}
function wideCharge(st){
  const stline = st.plugged_in == null && !st.charging_state ? '—' : ((st.plugged_in ? ctlEsc(st.charging_state || 'Plugged in') : 'Unplugged') + ' · limit ' + (st.charge_limit_pct == null ? '—' : st.charge_limit_pct + '%'));
  return `<div class="ctl-btn wide">
    <span class="ic">${ICONS.bolt}</span>
    <div class="grow"><div class="nm">Charging</div><div class="st">${stline}</div></div>
    <div class="ctl-actions">
      <div class="ctl-step">
        <button type="button" data-act="limit-down" aria-label="Lower charge limit"${CONTROL.busy?' disabled':''}>−</button>
        <span class="v">${st.charge_limit_pct == null ? '—' : st.charge_limit_pct + '%'}</span>
        <button type="button" data-act="limit-up" aria-label="Raise charge limit"${CONTROL.busy?' disabled':''}>+</button>
      </div>
      <button type="button" class="ctl-mini" data-act="charge-toggle"${CONTROL.busy?' disabled':''}>${(st.charging_state||'').toLowerCase()==='charging'?'Stop':'Start'}</button>
    </div>
  </div>`;
}

function paintEmbeddedAutos(){
  const box = document.getElementById('ctl-auto');
  if (!box || typeof renderAutomation !== 'function') {
    if (box) box.innerHTML = `<p class="ctl-src">Automation cards from the Automation tab would sit here.</p>`;
    return;
  }
  // Reuse existing cards by temporarily rendering into a detached main? Simpler: clone after a mini list.
  let items = null;
  try { items = (typeof AUTO !== 'undefined' && (AUTO.features || AUTO.items)) || null; } catch(e) { items = null; }
  if (!items) {
    box.innerHTML = `<p class="auto-note">The same automation cards from the Automation tab belong here. Open that tab to edit them.</p>`;
    return;
  }
  const on = items.filter(x => x.on).slice(0, 3);
  box.innerHTML = `<p class="auto-note" style="margin:0 0 8px">On means Lead Operator may run it. Off means don’t.</p>` +
    on.map(a => `<div class="auto-card"><div class="auto-row"><div class="auto-name">${ctlEsc(a.name)}</div></div><div class="auto-preview">${ctlEsc(a.action)}</div></div>`).join('');
}

function softwareData(){
  return controlMeta().software || {versions: [], by_version: {}};
}
function paintSoftware(main){
  const data = softwareData();
  if (CONTROL.view === 'software-detail' && CONTROL.detail) {
    paintSoftwareDetail(main, (data.versions || []).find(v => v.version === CONTROL.detail) || (data.versions || [])[0]);
    return;
  }
  const cur = (data.versions || [])[0] || {version: '—'};
  const badge = data.update_pending ? 'Update pending' : 'Installed · no update pending';
  const footTime = data.tessie_et ? ` Current version confirmed by Tessie at ${data.tessie_et}.` : '';
  main.innerHTML = `
    <section class="sw-cur">
      <div class="sw-ver">${ctlEsc(cur.version || '—')}</div>
      <div class="sw-sub">${ctlEsc(cur.fsd_note_title || data.fsd_note_title || '')} · Happy Truck</div>
      <span class="sw-badge">${ctlEsc(badge)}</span>
    </section>
    ${timeline(cur)}
    ${infographic(cur)}
    ${notesBlock(cur.version)}
    <div class="ctl-sec">Earlier versions</div>
    <div class="sw-hist">
      ${data.versions.slice(1).map(v => `
        <button type="button" class="sw-item" data-act="open-version" data-ver="${ctlEsc(v.version)}">
          <div><div class="v">${ctlEsc(v.version)}</div><div class="m">Available ${v.available ? ctlEsc(v.available) : 'not recorded'} · install not recorded</div></div>
          <span class="ctl-chev">${ICONS.chev}</span>
        </button>`).join('')}
    </div>
    <p class="sw-foot">${ctlEsc(data.history_note || '')}${ctlEsc(footTime)}</p>
  `;
}

function paintSoftwareDetail(main, v){
  if (!v) { main.innerHTML = `<p class="ctl-src">No software data.</p>`; return; }
  main.innerHTML = `
    <section class="sw-cur">
      <div class="sw-ver">${ctlEsc(v.version)}</div>
      <div class="sw-sub">${v.current ? 'Currently installed' : 'In this truck’s Tesla software history'}</div>
      ${v.current ? '<span class="sw-badge">Installed</span>' : ''}
    </section>
    ${timeline(v)}
    ${infographic(v)}
    ${notesBlock(v.version)}
  `;
}

function timeline(v){
  const rows = [
    ['Publicly available', v.available ? v.available : null, v.available_source, v.available_url],
    ['Download started', v.download_start, null, null],
    ['Install started', v.install_start, null, null],
    ['Install finished', v.install_finish, null, null],
    ['Download to install', v.duration, null, null],
  ];
  return `<section class="sw-time">
    ${rows.map(([l,val,src,url]) => `<div class="ctl-row"><span class="l">${l}</span><span class="r">${
      val ? ctlEsc(val) + (src ? ` <span class="sw-blank">(${ctlEsc(src)})</span>` : '') : '<span class="sw-blank">Not recorded</span>'
    }</span></div>`).join('')}
    ${v.available_note || urlLine(v)}
  </section>`;
}
function urlLine(v){
  if (!v.available_url) return '';
  const note = v.available_note ? ctlEsc(v.available_note) + ' ' : '';
  return `<p class="sw-src">${note}<a href="${ctlEsc(v.available_url)}" target="_blank" rel="noopener">${ctlEsc(v.available_source || 'Source')}</a></p>`;
}
function infographic(v){
  const ig = v.infographic || {};
  const cats = ig.categories || [];
  const phrases = ig.phrases || [];
  return `<section class="sw-info">
    <h3>What changed in this version</h3>
    <p class="sw-vs">${ig.vs_previous ? `Compared with ${ctlEsc(ig.vs_previous)}. ` : ''}${ctlEsc(ig.vs_note || '')}</p>
    <div class="sw-cats">${cats.map(c => `<div class="sw-cat"><div class="n" style="color:${ctlEsc(c.color)}">${c.count}</div><div class="k">${ctlEsc(c.label)}</div></div>`).join('')}</div>
    <div class="sw-phrases">${phrases.map(p => `<span class="sw-ph">${ctlEsc(p)}</span>`).join('')}</div>
  </section>`;
}
function notesBlock(version){
  const notes = ((CONTROL.notes || {}).by_version || {})[version] || [];
  if (!notes.length) return `<section class="sw-notes"><p class="sw-vs">No release notes recorded for this version.</p></section>`;
  return `<section class="sw-notes">
    <h3 style="margin:0 0 8px;font-size:15px">Release notes</h3>
    ${notes.map(n => `<article class="sw-note"><h4>${ctlEsc(n.title)}</h4><p>${ctlEsc(n.description || '')}</p></article>`).join('')}
    <p class="sw-src">Official Tesla notes via Tessie for this truck.</p>
  </section>`;
}

function paintWake(){
  const wrap = document.createElement('div');
  wrap.className = 'ctl-overlay mid';
  wrap.id = 'ctl-wake';
  wrap.innerHTML = `<div class="ctl-wake"><div class="ctl-spin"></div><h3>${ctlEsc(CONTROL.wakeLabel)}</h3><p>This can take 10 to 30 seconds. Then the command is sent and status is refreshed.</p></div>`;
  document.body.appendChild(wrap);
}
function clearWake(){ const el = document.getElementById('ctl-wake'); if (el) el.remove(); }

function paintConfirm(){
  const c = CONTROL.confirm;
  const sheet = document.getElementById('sheet');
  const body = document.getElementById('sheetbody');
  if (!sheet || !body || !c) return;
  body.innerHTML = `<div class="ctl-confirm">
    <h3>${ctlEsc(c.title)}</h3>
    <p>${ctlEsc(c.body)}</p>
    <label for="ctlconfirm">Type ${ctlEsc(c.word)} to confirm</label>
    <input id="ctlconfirm" autocomplete="off" autocapitalize="characters" spellcheck="false" placeholder="${ctlEsc(c.word)}">
    <label for="ctlpin">8-digit PIN</label>
    <input id="ctlpin" type="password" inputmode="numeric" maxlength="8" autocomplete="off" pattern="[0-9]*" placeholder="••••••••">
    <div class="row">
      <button type="button" class="cancel" data-act="confirm-cancel">Cancel</button>
      <button type="button" class="go" data-act="confirm-go" disabled>${ctlEsc(c.go)}</button>
    </div>
  </div>`;
  sheet.classList.remove('hidden');
  sheet.classList.add('ctl-sheet');
  const word = document.getElementById('ctlconfirm');
  const pin = document.getElementById('ctlpin');
  const go = body.querySelector('.ctl-confirm .go');
  const sync = () => {
    const ok = (word.value || '').trim().toUpperCase() === c.word && /^\d{8}$/.test(pin.value || '');
    go.disabled = !ok || CONTROL.busy;
  };
  word.addEventListener('input', sync);
  pin.addEventListener('input', sync);
  word.addEventListener('keydown', ev => { if (ev.key === 'Enter') { ev.preventDefault(); pin.focus(); } });
  pin.addEventListener('keydown', ev => { if (ev.key === 'Enter' && !go.disabled) { ev.preventDefault(); go.click(); } });
  setTimeout(() => word.focus(), 50);
}
function closeConfirm(){
  CONTROL.confirm = null;
  const sheet = document.getElementById('sheet');
  if (sheet) { sheet.classList.add('hidden'); sheet.classList.remove('ctl-sheet'); }
}

const RISK = {
  unlock: {cmd:'unlock', title:'Unlock Happy Truck?', word:'UNLOCK', go:'Unlock', body:'This will unlock the truck. Type UNLOCK and enter your PIN to confirm.'},
  'tonneau-open': {cmd:'tonneau-open', title:'Open the tonneau?', word:'OPEN', go:'Open tonneau', body:'The tonneau will open. Type OPEN and enter your PIN to confirm.'},
  frunk: {cmd:'frunk-open', title:'Open the frunk?', word:'FRUNK', go:'Open frunk', body:'There is no remote frunk close. Type FRUNK and enter your PIN to confirm.'},
  trunk: {cmd:'trunk', title:'Open the trunk?', word:'TRUNK', go:'Open trunk', body:'Type TRUNK and enter your PIN to confirm.'},
  'windows-vent': {cmd:'windows-vent', title:'Vent the windows?', word:'VENT', go:'Vent windows', body:'The windows will vent. Type VENT and enter your PIN to confirm.'}
};

function handleControlClick(e){
  const actEl = e.target.closest('[data-act]');
  if (!actEl) return true;
  const act = actEl.dataset.act;
  e.preventDefault();
  e.stopPropagation();
  if (act === 'confirm-cancel') { closeConfirm(); return false; }
  if (act === 'confirm-go') {
    void submitRiskyCommand();
    return false;
  }
  if (act === 'open-software') { CONTROL.view = 'software'; CONTROL.detail = null; renderControl(); return false; }
  if (act === 'open-version') { CONTROL.view = 'software-detail'; CONTROL.detail = actEl.dataset.ver; renderControl(); return false; }
  if (act === 'goto-auto') {
    if (typeof S !== 'undefined') { S.mode = 'automation'; localStorage.setItem('ht_mode', 'automation'); }
    if (typeof render === 'function') render();
    return false;
  }
  if (RISK[act]) {
    CONTROL.confirm = Object.assign({id: act}, RISK[act]);
    paintConfirm();
    return false;
  }
  void runSafeCommand(act);
  return false;
}

function ctlToken(){
  try { return localStorage.getItem(CTL_TOKEN_KEY) || ''; } catch (e) { return ''; }
}

async function afterTrackerUnlock(pass){
  // Keep the passcode in memory for this page visit only, never in localStorage or this file.
  if (pass) CONTROL._pass = pass;
  try { await mintControlSession(); } catch (e) {}
}

async function mintControlSession(){
  const pass = CONTROL._pass;
  if (!pass) return !!ctlToken();
  const r = await fetch(CTL_API + '/session', {
    method: 'POST',
    headers: {'Content-Type': 'application/json'},
    body: JSON.stringify({passcode: pass})
  });
  const data = await r.json().catch(() => ({}));
  if (data && data.ok && data.token) {
    try { localStorage.setItem(CTL_TOKEN_KEY, data.token); } catch (e) {}
    return true;
  }
  return false;
}

function applyCommandState(snap){
  if (!snap || !snap.present) return;
  const st = CONTROL.st || (CONTROL.st = {});
  if (snap.battery != null) st.battery_pct = snap.battery;
  if (snap.range != null) st.rated_range_mi = Math.round(Number(snap.range));
  if (snap.locked != null) st.locked = snap.locked;
  if (snap.climate_on != null) st.climate_on = snap.climate_on;
  if (snap.set_temp_f != null) st.set_temp_f = snap.set_temp_f;
  if (snap.inside_f != null) st.cabin_f = snap.inside_f;
  if (snap.outside_f != null) st.outside_f = snap.outside_f;
  if (snap.charging != null) {
    st.charging_state = snap.charging;
    const ch = String(snap.charging).toLowerCase();
    st.plugged_in = ch !== 'disconnected' && ch !== 'unplugged' && ch !== '';
  }
  if (snap.charge_limit != null) st.charge_limit_pct = snap.charge_limit;
  if (snap.sentry != null) st.sentry = snap.sentry;
  if (snap.state != null) st.vehicle_state = snap.state;
  st.last_seen_et = new Date().toLocaleTimeString('en-US', {timeZone:'America/Detroit', hour:'numeric', minute:'2-digit'}) + ' ET';
}

function setCtlResult(ok, text){
  CONTROL.result = {ok: !!ok, text: text || (ok ? 'Done' : 'Command failed')};
}

function nextHeat(n){
  const cur = Number(n) || 0;
  const nxt = cur >= 3 ? 0 : cur + 1;
  return ['off','low','medium','high'][nxt];
}

function buildSafePayload(act){
  const st = CONTROL.st || {};
  if (act === 'lock') return {cmd: 'lock'};
  if (act === 'sentry') return {cmd: st.sentry ? 'sentry-off' : 'sentry-on'};
  if (act === 'climate') return {cmd: st.climate_on ? 'climate-off' : 'climate-on'};
  if (act === 'temp-down' || act === 'temp-up') {
    if (st.set_temp_f == null) return {error: 'Set temperature is not available yet.'};
    const t = Number(st.set_temp_f) + (act === 'temp-up' ? 1 : -1);
    if (t < 50 || t > 90) return {error: 'Temperature must stay between 50 and 90°F.'};
    return {cmd: 'climate-set-temp', temp_f: t};
  }
  if (act === 'charge-toggle') {
    const ch = String(st.charging_state || '').toLowerCase();
    return {cmd: ch === 'charging' ? 'charging-stop' : 'charging-start'};
  }
  if (act === 'limit-down' || act === 'limit-up') {
    if (st.charge_limit_pct == null) return {error: 'Charge limit is not available yet.'};
    const n = Number(st.charge_limit_pct) + (act === 'limit-up' ? 1 : -1);
    if (n < 50 || n > 100) return {error: 'Charge limit must stay between 50 and 100%.'};
    return {cmd: 'charging-set-limit', percent: n};
  }
  if (act === 'wheel') return {cmd: 'steering-wheel-heater', state: st.steering_heat ? 'off' : 'on'};
  if (act === 'seat-l') return {cmd: 'seat-heater', seat: 'front-left', level: nextHeat(st.seat_heater_left)};
  if (act === 'seat-r') return {cmd: 'seat-heater', seat: 'front-right', level: nextHeat(st.seat_heater_right)};
  if (act === 'honk') return {cmd: 'honk'};
  if (act === 'flash') return {cmd: 'flash-lights'};
  if (act === 'windows-close') return {cmd: 'windows-close'};
  if (act === 'tonneau-close') return {cmd: 'tonneau-close'};
  if (act === 'port') return {cmd: st.charge_port_open ? 'charge-port-close' : 'charge-port-open'};
  if (act === 'media') return {cmd: 'media-toggle-playback'};
  if (act === 'wake') return {cmd: 'wake'};
  if (act === 'defrost') return {error: 'Defrost is not available in this version.'};
  return {error: 'That control is not available in this version.'};
}

async function ctlApi(path, body, token){
  const headers = {'Content-Type': 'application/json'};
  if (token) headers.Authorization = 'Bearer ' + token;
  const r = await fetch(CTL_API + path, {
    method: 'POST',
    headers,
    body: JSON.stringify(body || {})
  });
  const data = await r.json().catch(() => ({}));
  return {status: r.status, data};
}

async function sendCommand(payload){
  let token = ctlToken();
  if (!token && CONTROL._pass) {
    await mintControlSession();
    token = ctlToken();
  }
  if (!token) {
    return {ok: false, error: 'Unlock the tracker again to enable remote controls.'};
  }
  let res = await ctlApi('/command', payload, token);
  if (res.status === 401 && CONTROL._pass) {
    await mintControlSession();
    token = ctlToken();
    if (token) res = await ctlApi('/command', payload, token);
  }
  const d = res.data || {};
  if (res.status === 401) return {ok: false, error: 'Session expired. Unlock the tracker again to use controls.'};
  if (res.status === 429) return {ok: false, error: 'Too many requests. Try again in a minute.'};
  if (res.status === 503) return {ok: false, error: 'Remote control is temporarily disabled.'};
  if (res.status === 403) return {ok: false, error: d.error === 'confirm required' || d.error === 'confirm mismatch' ? 'Confirm word did not match.' : (d.error === 'pin required' || d.error === 'auth failed' ? 'PIN was not accepted.' : (d.error === 'risky disabled' ? 'Risky commands are locked. Ask me to reset them.' : (d.error || 'Command not allowed')))};
  if (d.state) applyCommandState(d.state);
  if (d.ok) return {ok: true, detail: d.detail, data: d};
  return {ok: false, error: d.error || d.detail || 'Command failed'};
}

async function runSafeCommand(act){
  if (CONTROL.busy) return;
  const payload = buildSafePayload(act);
  if (payload.error) { setCtlResult(false, payload.error); renderControl(); return; }
  CONTROL.busy = true;
  CONTROL.result = null;
  showWakeThen('Waking truck…');
  try {
    const res = await sendCommand(payload);
    setCtlResult(res.ok, res.ok ? 'Done' : (res.error || 'Command failed'));
  } catch (e) {
    setCtlResult(false, 'Could not reach the command service.');
  } finally {
    CONTROL.busy = false;
    CONTROL.waking = false;
    clearWake();
    renderControl();
  }
}

async function submitRiskyCommand(){
  const c = CONTROL.confirm;
  if (!c || CONTROL.busy) return;
  const wordEl = document.getElementById('ctlconfirm');
  const pinEl = document.getElementById('ctlpin');
  const word = (wordEl && wordEl.value || '').trim();
  const pin = (pinEl && pinEl.value || '');
  if (word.toUpperCase() !== c.word || !/^\d{8}$/.test(pin)) return;
  const payload = {cmd: c.cmd, confirm: c.word, pin: pin};
  if (pinEl) pinEl.value = '';
  closeConfirm();
  CONTROL.busy = true;
  CONTROL.result = null;
  showWakeThen('Waking truck…');
  try {
    const res = await sendCommand(payload);
    setCtlResult(res.ok, res.ok ? 'Done' : (res.error || 'Command failed'));
  } catch (e) {
    setCtlResult(false, 'Could not reach the command service.');
  } finally {
    CONTROL.busy = false;
    CONTROL.waking = false;
    clearWake();
    renderControl();
  }
}

function showWakeThen(label){
  CONTROL.waking = true;
  CONTROL.wakeLabel = label;
  paintWake();
}

function ctlBack(){
  if (CONTROL.view === 'software-detail') { CONTROL.view = 'software'; CONTROL.detail = null; renderControl(); return; }
  if (CONTROL.view === 'software') { CONTROL.view = 'home'; renderControl(); }
}

function hookControl(){
  if (CONTROL.hooked) return;
  CONTROL.hooked = true;
  const back = document.getElementById('ctlback');
  if (back) back.addEventListener('click', ctlBack);
  document.addEventListener('click', e => {
    if (!(typeof S !== 'undefined' && S.mode === 'control')) return;
    if (e.target.closest('[data-act], .ctl-overlay, .ctl-sheet')) handleControlClick(e);
  }, true);
  // wrap setModeClass / render if present
  const _set = window.setModeClass;
  // setModeClass is not on window (function in classic script). Patch via render hook instead.
  const origRender = window.render;
  // render is also a function declaration - in classic scripts it is a global.
}

window.handleControlClick = handleControlClick;
window.renderControl = renderControl;
window.ctlBack = ctlBack;
window.afterTrackerUnlock = afterTrackerUnlock;
document.addEventListener('DOMContentLoaded', hookControl);
if (document.readyState !== 'loading') hookControl();
