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
  result: null,          // {ok, text}
  enablePrompt: false,
  enableError: '',
  enableBusy: false
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
  if (title) title.textContent = CONTROL.view === 'home' ? 'Vehicle Control' : 'Software';
}

function seedControlState(){
  if (CONTROL.st) return;
  const {status} = controlMeta();
  CONTROL.st = Object.assign({}, status);
  CONTROL.stSource = CONTROL.stSource || 'published';
}
function renderControl(){
  seedControlState();
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
  const fresh = ctlIsFresh(st);
  const driving = fresh && st.gear && st.gear !== 'P' && st.gear !== 'N';
  const driveLabel = driving ? `Driving · ${dash(st.speed_mph)} mph` : 'Parked';
  const clim = ctlClimateLabel(st, fresh);
  const charge = st.plugged_in == null && !st.charging_state ? '—' : (st.plugged_in ? dash(st.charging_state || 'Plugged in') : 'Unplugged');
  const live = ctlLiveLabel(st, fresh);
  const srcParts = [];
  if (st.last_seen_et) srcParts.push((fresh ? 'Live ' : 'Last seen ') + st.last_seen_et);
  if (st.tessie_et && st.tessie_et !== st.last_seen_et) srcParts.push('Tessie ' + st.tessie_et);
  const srcLine = srcParts.length ? srcParts.join(' · ') : 'Status unavailable';
  const cabin = (st.cabin_f == null && st.outside_f == null) ? '—' : `${dash(st.cabin_f)}°F / ${dash(st.outside_f)}°F`;
  const doors = st.locked == null ? '—' : (st.locked ? 'Locked' : 'Unlocked');
  const sentry = st.sentry == null ? '—' : (st.sentry ? 'On' : 'Off');
  const swVer = dash(st.software_version);
  main.innerHTML = `
    <section class="ctl-status">
      <div class="ctl-status-top">
        <span class="ctl-pill${driving ? ' drive' : ''}">${driveLabel}</span>
        <span class="ctl-live${fresh ? '' : ' stale'}"><i></i>${live}</span>
      </div>
      <div class="ctl-hero">
        <div><div class="n bat ${st.battery_pct == null ? '' : (+st.battery_pct >= 50 ? 'lv-ok' : +st.battery_pct >= 20 ? 'lv-mid' : 'lv-low')}">${st.battery_pct == null ? '—' : st.battery_pct}${st.battery_pct == null ? '' : '<small>%</small>'}</div><div class="k">Battery</div></div>
        <div><div class="n rng">${st.rated_range_mi == null ? '—' : st.rated_range_mi}${st.rated_range_mi == null ? '' : '<small> mi</small>'}</div><div class="k">Rated range</div></div>
      </div>
      <div class="ctl-chips">
        <div class="ctl-chip${st.locked === false ? ' alert' : ''}">
          <span class="ic">${ICONS.lock}</span>
          <span class="k">Doors</span>
          <span class="v">${doors}</span>
        </div>
        <div class="ctl-chip${fresh && st.climate_on ? ' on' : ''}">
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
        <button type="button" class="ctl-chip ctl-chip-link" data-act="open-software" aria-label="Open software ${ctlEsc(String(swVer))}">
          <span class="ic">${ICONS.software}</span>
          <span class="k">Software</span>
          <span class="v" title="${ctlEsc(String(swVer))}">${ctlEsc(String(swVer).split('.').slice(0, 3).join('.'))}</span>
          <span class="ctl-chev" aria-hidden="true">${ICONS.chev}</span>
        </button>
      </div>
      <p class="ctl-src">${ctlEsc(srcLine)}</p>
      ${ctlRefreshRow()}
    </section>

    <div class="ctl-sec">Quick controls</div>
    ${ctlEnableBlock()}
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
  if (typeof S !== 'undefined' && S.mode === 'control' && ctlReady() && !CONTROL._statusOnce && !CONTROL.busy && !CONTROL.refreshing) {
    CONTROL._statusOnce = true;
    void refreshStatus({wake: false, fromUser: false});
  }
  if (!ctlReady() && CONTROL.enablePrompt) {
    const pinp = document.getElementById('ctlenablepass');
    if (pinp) {
      pinp.addEventListener('keydown', ev => {
        if (ev.key === 'Enter') { ev.preventDefault(); void submitEnable(); }
      });
      if (!CONTROL.enableBusy) setTimeout(() => pinp.focus(), 50);
    }
  }
}

function heatLabel(n){ return n ? ['Off','Low','Med','High'][n] || String(n) : 'Off'; }
function ctlReady(){ return !!ctlToken(); }
function ctlCmdDisabled(){ return CONTROL.busy || !ctlReady(); }
function ctlDis(){ return ctlCmdDisabled() ? ' disabled' : ''; }
function btn(id, name, st, icon, on){
  return `<button type="button" class="ctl-btn${on?' on':''}" data-act="${id}"${ctlDis()}><span class="ic">${icon}</span><span class="nm">${name}</span><span class="st">${ctlEsc(dash(st))}</span></button>`;
}
function rbtn(id, name, st, icon){
  return `<button type="button" class="ctl-rbtn" data-act="${id}"${ctlDis()}><span class="ic">${icon}</span><span><div class="nm">${name}</div><div class="st">${ctlEsc(st)}</div></span></button>`;
}
function wideClimate(st){
  const fresh = ctlIsFresh(st);
  const onoff = st.climate_on == null ? '—' : ((fresh ? '' : 'Last known · ') + (st.climate_on ? 'On' : 'Off'));
  return `<div class="ctl-btn wide ${fresh && st.climate_on?'on':''}">
    <span class="ic">${ICONS.climate}</span>
    <div class="grow"><div class="nm">Climate</div><div class="st">${onoff} · cabin ${st.cabin_f == null ? '—' : st.cabin_f + '°F'}</div></div>
    <div class="ctl-actions">
      <div class="ctl-step">
        <button type="button" data-act="temp-down" aria-label="Lower temperature"${ctlDis()}>−</button>
        <span class="v">${ctlSetpointF(st) == null ? '—' : ctlSetpointF(st) + '°F'}</span>
        <button type="button" data-act="temp-up" aria-label="Raise temperature"${ctlDis()}>+</button>
      </div>
      <button type="button" class="ctl-mini" data-act="climate"${ctlDis()}>${st.climate_on?'Turn off':'Turn on'}</button>
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
        <button type="button" data-act="limit-down" aria-label="Lower charge limit"${ctlDis()}>−</button>
        <span class="v">${st.charge_limit_pct == null ? '—' : st.charge_limit_pct + '%'}</span>
        <button type="button" data-act="limit-up" aria-label="Raise charge limit"${ctlDis()}>+</button>
      </div>
      <button type="button" class="ctl-mini" data-act="charge-toggle"${ctlDis()}>${(st.charging_state||'').toLowerCase()==='charging'?'Stop':'Start'}</button>
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
  box.innerHTML = `<p class="auto-note" style="margin:0 0 8px">On means the droplet engine may run it. Off means it won’t.</p>` +
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
  if (act === 'enable-controls') {
    CONTROL.enablePrompt = true;
    CONTROL.enableError = '';
    renderControl();
    return false;
  }
  if (act === 'enable-cancel') {
    CONTROL.enablePrompt = false;
    CONTROL.enableError = '';
    renderControl();
    return false;
  }
  if (act === 'enable-submit') {
    void submitEnable();
    return false;
  }
  if (act === 'refresh-status') {
    void refreshStatus({wake: false, fromUser: true});
    return false;
  }
  if (act === 'wake-refresh') {
    void refreshStatus({wake: true, fromUser: true});
    return false;
  }
  if (act === 'open-software') { CONTROL.view = 'software'; CONTROL.detail = null; renderControl(); return false; }
  if (act === 'open-version') { CONTROL.view = 'software-detail'; CONTROL.detail = actEl.dataset.ver; renderControl(); return false; }
  if (act === 'goto-auto') {
    if (typeof S !== 'undefined') { S.mode = 'automation'; localStorage.setItem('ht_mode', 'automation'); }
    if (typeof render === 'function') render();
    return false;
  }
  if (!ctlReady()) {
    CONTROL.enablePrompt = true;
    CONTROL.enableError = '';
    renderControl();
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
function clearCtlToken(){
  try { localStorage.removeItem(CTL_TOKEN_KEY); } catch (e) {}
}
function ctlEnableBlock(){
  if (ctlReady()) return '';
  const err = CONTROL.enableError ? `<p class="ctl-enable-err">${ctlEsc(CONTROL.enableError)}</p>` : '';
  if (CONTROL.enablePrompt) {
    return `<div class="ctl-enable" id="ctl-enable">
      <p>Enter your tracker passcode to enable remote controls on this device for 30 days.</p>
      <label for="ctlenablepass">Tracker passcode</label>
      <input id="ctlenablepass" type="password" autocomplete="off" spellcheck="false"${CONTROL.enableBusy ? ' disabled' : ''}>
      ${err}
      <div class="row">
        <button type="button" class="cancel" data-act="enable-cancel"${CONTROL.enableBusy ? ' disabled' : ''}>Cancel</button>
        <button type="button" class="go" data-act="enable-submit"${CONTROL.enableBusy ? ' disabled' : ''}>Enable</button>
      </div>
    </div>`;
  }
  return `<div class="ctl-enable" id="ctl-enable">
    <p>Remote controls need a one-time passcode on this device. They’re then good for 30 days.</p>
    ${err}
    <button type="button" class="ctl-enable-btn" data-act="enable-controls">Enable remote controls</button>
  </div>`;
}
async function submitEnable(){
  if (CONTROL.enableBusy) return;
  const el = document.getElementById('ctlenablepass');
  const pass = (el && el.value || '').trim().toLowerCase();
  if (el) el.value = '';
  if (!pass) {
    CONTROL.enableError = 'Enter your tracker passcode.';
    renderControl();
    return;
  }
  CONTROL.enableBusy = true;
  CONTROL.enableError = '';
  renderControl();
  try {
    CONTROL._pass = pass;
    const ok = await mintControlSession();
    if (ok && ctlToken()) {
      CONTROL.enablePrompt = false;
      CONTROL.enableError = '';
      setCtlResult(true, 'Remote controls enabled on this device.');
      CONTROL._statusOnce = true;
      void refreshStatus({wake: false, fromUser: false});
    } else {
      CONTROL._pass = '';
      CONTROL.enableError = 'That passcode didn’t work. Try again.';
    }
  } catch (e) {
    CONTROL._pass = '';
    CONTROL.enableError = 'Could not reach the command service.';
  } finally {
    CONTROL.enableBusy = false;
    renderControl();
  }
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

const CTL_FRESH_MS = 3 * 60 * 1000;
function ctlTs(st){
  if (!st) return null;
  const t = st.last_seen_ts;
  if (t == null || t === '') return null;
  const n = Number(t);
  if (!Number.isFinite(n) || n <= 0) return null;
  return n > 1e12 ? Math.round(n / 1000) : Math.round(n);
}
function ctlIsFresh(st){
  const t = ctlTs(st);
  if (!t) return false;
  const age = Date.now() - t * 1000;
  return age >= 0 && age <= CTL_FRESH_MS;
}
function ctlClock(st){
  const et = st && st.last_seen_et;
  if (et) return String(et).replace(/\s*ET\s*$/i, '').trim();
  const t = ctlTs(st);
  if (!t) return '—';
  return new Date(t * 1000).toLocaleTimeString('en-US', {timeZone:'America/Detroit', hour:'numeric', minute:'2-digit'});
}
function ctlSleepWord(st){
  const v = String((st && st.vehicle_state) || '').toLowerCase();
  if (v === 'asleep' || v === 'offline' || v === 'low_power' || v === 'standby') return 'asleep';
  return '';
}
function ctlLiveLabel(st, fresh){
  const clock = ctlClock(st);
  if (fresh) return 'Live ' + clock + ' ET';
  const sleep = ctlSleepWord(st);
  return sleep ? ('Last seen ' + clock + ' · ' + sleep) : ('Last seen ' + clock);
}
function ctlClimateLabel(st, fresh){
  if (st.climate_on == null) return '—';
  const sp = ctlSetpointF(st);
  const val = st.climate_on ? ('On · ' + (sp == null ? '—' : sp + '°F')) : 'Off';
  return fresh ? val : ('Last known · ' + val);
}
function ctlSetpointF(st){
  if (!st || st.set_temp_f == null || st.set_temp_f === '') return null;
  const n = Number(st.set_temp_f);
  if (!Number.isFinite(n)) return null;
  return Math.round(n);
}
function ctlRefreshRow(){
  const busy = CONTROL.busy || CONTROL.refreshing;
  const updating = CONTROL.refreshing && !CONTROL.waking;
  return `<div class="ctl-refresh">
    <button type="button" class="ctl-refresh-btn" data-act="refresh-status"${busy?' disabled':''}>${updating ? 'Updating…' : 'Refresh'}</button>
    <button type="button" class="ctl-wake-refresh" data-act="wake-refresh"${busy?' disabled':''}>Wake &amp; refresh</button>
  </div>`;
}
function applyLiveState(snap, source){
  if (!snap) return false;
  const body = (snap.state && typeof snap.state === 'object' && (snap.state.battery != null || snap.state.battery_pct != null || snap.state.climate_on != null || snap.state.present || snap.state.last_seen_ts)) ? snap.state : snap;
  if (body.present === false && body.battery_pct == null && body.battery == null && body.climate_on == null && body.last_seen_ts == null) return false;
  const st = CONTROL.st || (CONTROL.st = {});
  const pick = (a, b) => (a != null ? a : b);
  if (pick(body.battery_pct, body.battery) != null) st.battery_pct = Math.round(Number(pick(body.battery_pct, body.battery)));
  if (pick(body.rated_range_mi, body.range) != null) st.rated_range_mi = Math.round(Number(pick(body.rated_range_mi, body.range)));
  if (body.locked != null) st.locked = body.locked;
  if (body.climate_on != null) st.climate_on = body.climate_on;
  if (body.set_temp_f != null) st.set_temp_f = body.set_temp_f;
  if (pick(body.cabin_f, body.inside_f) != null) st.cabin_f = pick(body.cabin_f, body.inside_f);
  if (body.outside_f != null) st.outside_f = body.outside_f;
  const charging = pick(body.charging_state, body.charging);
  if (charging != null) {
    st.charging_state = charging;
    const ch = String(charging).toLowerCase();
    st.plugged_in = body.plugged_in != null ? body.plugged_in : (ch !== 'disconnected' && ch !== 'unplugged' && ch !== '');
  }
  if (body.plugged_in != null) st.plugged_in = body.plugged_in;
  if (pick(body.charge_limit_pct, body.charge_limit) != null) st.charge_limit_pct = pick(body.charge_limit_pct, body.charge_limit);
  if (body.sentry != null) st.sentry = body.sentry;
  if (pick(body.vehicle_state, body.state) != null && typeof pick(body.vehicle_state, body.state) !== 'object') st.vehicle_state = pick(body.vehicle_state, body.state);
  if (body.gear != null) st.gear = body.gear;
  if (body.speed_mph != null) st.speed_mph = body.speed_mph;
  if (body.seat_heater_left != null) st.seat_heater_left = body.seat_heater_left;
  if (body.seat_heater_right != null) st.seat_heater_right = body.seat_heater_right;
  if (body.steering_heat != null) st.steering_heat = body.steering_heat;
  if (body.charge_port_open != null) st.charge_port_open = body.charge_port_open;
  const ts = pick(body.last_seen_ts, snap.last_seen_ts);
  if (ts != null) st.last_seen_ts = ctlTs({last_seen_ts: ts}) || st.last_seen_ts;
  const et = pick(body.last_seen_et, snap.last_seen_et);
  if (et) st.last_seen_et = et;
  else if (st.last_seen_ts) st.last_seen_et = ctlClock(st) + ' ET';
  if (snap.tessie_et) st.tessie_et = snap.tessie_et;
  if (body.tessie_et) st.tessie_et = body.tessie_et;
  if (snap.tessie_ts) st.tessie_ts = snap.tessie_ts;
  if (source) CONTROL.stSource = source;
  else if (body.source) CONTROL.stSource = body.source;
  else if (snap.source) CONTROL.stSource = snap.source;
  return true;
}
function applyCommandState(snap){ return applyLiveState(snap, (snap && snap.source) || 'vehicle_data'); }
function newerThanCurrent(snap){
  const incoming = ctlTs(snap && snap.state && typeof snap.state === 'object' ? Object.assign({}, snap, snap.state) : snap);
  const cur = ctlTs(CONTROL.st);
  if (!incoming) return false;
  if (!cur) return true;
  return incoming >= cur;
}
function commandDisagrees(payload, st){
  if (!payload || !st) return '';
  const cmd = payload.cmd;
  if (cmd === 'climate-on' && st.climate_on === false) return 'Sent, but the truck reports climate is still off.';
  if (cmd === 'climate-off' && st.climate_on === true) return 'Sent, but the truck reports climate is still on.';
  if (cmd === 'climate-set-temp' && payload.temp_f != null && st.set_temp_f != null && Number(st.set_temp_f) !== Number(payload.temp_f)) {
    return 'Sent, but the truck reports ' + ctlSetpointF(st) + '°F, not ' + payload.temp_f + '°F.';
  }
  if (cmd === 'lock' && st.locked === false) return 'Sent, but the truck reports the doors are still unlocked.';
  if ((cmd === 'unlock' || cmd === 'door-unlock') && st.locked === true) return 'Sent, but the truck reports the doors are still locked.';
  if (cmd === 'sentry-on' && st.sentry === false) return 'Sent, but the truck reports Sentry is still off.';
  if (cmd === 'sentry-off' && st.sentry === true) return 'Sent, but the truck reports Sentry is still on.';
  return '';
}
async function ctlApiGet(path, token){
  const headers = {};
  if (token) headers.Authorization = 'Bearer ' + token;
  const r = await fetch(CTL_API + path, {method: 'GET', headers, cache: 'no-store'});
  const data = await r.json().catch(() => ({}));
  return {status: r.status, data};
}
async function refreshStatus(opts){
  const wake = !!(opts && opts.wake);
  const fromUser = !!(opts && opts.fromUser);
  if (wake) {
    if (CONTROL.busy) return;
    if (!ctlReady()) { CONTROL.enablePrompt = true; renderControl(); return; }
    CONTROL.busy = true;
    CONTROL.result = {ok: true, text: 'Sent — confirming…'};
    showWakeThen('Waking truck…');
    try {
      const res = await sendCommand({cmd: 'wake'});
      const st = CONTROL.st || {};
      if (res.ok && res.confirmed) setCtlResult(true, 'Confirmed');
      else if (res.ok) setCtlResult(true, 'Sent, but not yet confirmed.');
      else setCtlResult(false, res.error || 'Wake failed');
    } catch (e) {
      setCtlResult(false, 'Could not reach the command service.');
    } finally {
      CONTROL.busy = false;
      CONTROL.waking = false;
      clearWake();
      renderControl();
    }
    return;
  }
  if (CONTROL.busy || CONTROL.refreshing) return;
  if (!ctlReady()) { if (fromUser) { CONTROL.enablePrompt = true; renderControl(); } return; }
  CONTROL.refreshing = true;
  if (fromUser) { CONTROL.result = null; }
  renderControl();
  try {
    let token = ctlToken();
    let res = await ctlApiGet('/status', token);
    if (res.status === 401 && CONTROL._pass) {
      await mintControlSession();
      token = ctlToken();
      if (token) res = await ctlApiGet('/status', token);
    }
    if (res.status === 401) {
      clearCtlToken();
      CONTROL._pass = '';
      CONTROL.enablePrompt = true;
      setCtlResult(false, 'Session expired. Enable remote controls to continue.');
      return;
    }
    const d = res.data || {};
    if (d && (d.state || d.present || d.last_seen_ts)) {
      if (newerThanCurrent(d) || !ctlTs(CONTROL.st) || fromUser) {
        applyLiveState(d, d.source || 'cache');
      }
      if (fromUser) setCtlResult(true, 'Updated from current cache, without waking the truck.');
    } else if (fromUser) {
      setCtlResult(false, 'Could not read current status.');
    }
  } catch (e) {
    if (fromUser) setCtlResult(false, 'Could not reach the command service.');
  } finally {
    CONTROL.refreshing = false;
    renderControl();
  }
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
    const cur = ctlSetpointF(st);
    if (cur == null) return {error: 'Set temperature is not available yet.'};
    const t = cur + (act === 'temp-up' ? 1 : -1);
    if (t < 59 || t > 82) return {error: 'Temperature must stay between 59 and 82°F.'};
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
    CONTROL.enablePrompt = true;
    return {ok: false, error: 'Enable remote controls to continue.'};
  }
  let res = await ctlApi('/command', payload, token);
  if (res.status === 401 && CONTROL._pass) {
    await mintControlSession();
    token = ctlToken();
    if (token) res = await ctlApi('/command', payload, token);
  }
  const d = res.data || {};
  if (res.status === 401) {
    clearCtlToken();
    CONTROL._pass = '';
    CONTROL.enablePrompt = true;
    return {ok: false, error: 'Session expired. Enable remote controls to continue.'};
  }
  if (res.status === 429) return {ok: false, error: 'Too many requests. Try again in a minute.'};
  if (res.status === 503) return {ok: false, error: 'Remote control is temporarily disabled.'};
  if (res.status === 403) return {ok: false, error: d.error === 'confirm required' || d.error === 'confirm mismatch' ? 'Confirm word did not match.' : (d.error === 'pin required' || d.error === 'auth failed' ? 'PIN was not accepted.' : (d.error === 'risky disabled' ? 'Risky commands are locked. Ask me to reset them.' : (d.error || 'Command not allowed')))};
  let applied = false;
  if (d.state) applied = !!applyCommandState(d.state);
  const confirmed = d.confirmed === true;
  const disagree = confirmed ? commandDisagrees(payload, CONTROL.st) : '';
  if (d.ok) return {ok: true, detail: d.detail, data: d, applied, confirmed, disagree};
  return {ok: false, error: d.error || d.detail || 'Command failed', applied, confirmed, disagree};
}

async function runSafeCommand(act){
  if (CONTROL.busy) return;
  const payload = buildSafePayload(act);
  if (payload.error) { setCtlResult(false, payload.error); renderControl(); return; }
  CONTROL.busy = true;
  CONTROL.result = {ok: true, text: 'Sent — confirming…'};
  showWakeThen('Waking truck…');
  renderControl();
  try {
    const res = await sendCommand(payload);
    if (!res.ok) setCtlResult(false, res.error || 'Command failed');
    else if (res.disagree) setCtlResult(false, res.disagree);
    else if (res.confirmed) setCtlResult(true, 'Confirmed');
    else setCtlResult(true, 'Sent, but not yet confirmed.');
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
  CONTROL.result = {ok: true, text: 'Sent — confirming…'};
  showWakeThen('Waking truck…');
  renderControl();
  try {
    const res = await sendCommand(payload);
    if (!res.ok) setCtlResult(false, res.error || 'Command failed');
    else if (res.disagree) setCtlResult(false, res.disagree);
    else if (res.confirmed) setCtlResult(true, 'Confirmed');
    else setCtlResult(true, 'Sent, but not yet confirmed.');
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
  document.addEventListener('click', e => {
    const tab = e.target.closest && e.target.closest('#tabbar button[data-mode]');
    if (!tab) return;
    const mode = tab.getAttribute('data-mode');
    if (mode !== 'control') CONTROL._statusOnce = false;
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
