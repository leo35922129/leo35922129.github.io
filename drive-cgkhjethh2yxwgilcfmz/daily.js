/* Team Daily Reports tab (v81). Data: S.meta.daily_reports (encrypted payload), newest first.
   Mirrors News: one day at a time, ‹ date › in the top row, Archive pill lists past days by month.
   Audio: r.audio.file = d/a-<date>-<hash>.bin = iv(12) + AES-GCM(mp3) with the payload key (S.key); decrypted to a blob URL. */
(function () {
  const DAILY = window.DAILY = { date: null, archive: false, blobs: {}, loading: {} };
  const e = s => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const MON = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
  const DOW = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
  const hrs = v => (Math.round(v * 10) / 10).toString();
  const L = a => Array.isArray(a) ? a.filter(x => typeof x === 'string' && x.trim()) : [];
  const svg = (p, cls) => `<svg class="${cls || 'dr-ico'}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${p}</svg>`;
  const ICO = {
    overview: '<path d="M7 3h7l5 5v13H7z"/><path d="M14 3v5h5M10 13h6M10 17h4"/>',
    blocker: '<path d="M12 3.5 2.5 20h19z"/><path d="M12 10v4.5M12 17.4v.1"/>',
    question: '<circle cx="12" cy="12" r="9"/><path d="M9.6 9.4a2.5 2.5 0 1 1 3.4 2.4c-.6.3-1 .8-1 1.6v.3M12 17.3v.1"/>',
    bulb: '<path d="M9.5 18h5M10.5 21h3"/><path d="M12 3a6 6 0 0 0-3.6 10.8c.7.6 1.1 1.3 1.1 2.2h5c0-.9.4-1.6 1.1-2.2A6 6 0 0 0 12 3z"/>',
    wrench: '<path d="M14.5 6.5a4 4 0 0 0-5.2 5.2L3.5 17.5l3 3 5.8-5.8a4 4 0 0 0 5.2-5.2l-2.4 2.4-2.6-.6-.6-2.6z"/>',
    sparkle: '<path d="M12 3.5l1.9 5.1 5.1 1.9-5.1 1.9L12 17.5l-1.9-5.1L5 10.5l5.1-1.9z"/><path d="M18.5 16v4M16.5 18h4"/>',
    request: '<path d="M4 5h16v11H9.5L5 20v-4H4z"/><path d="M8 9.5h8M8 12.5h5"/>',
    team: '<circle cx="9" cy="8.5" r="3"/><path d="M3.5 19a5.5 5.5 0 0 1 11 0"/><circle cx="17" cy="9.5" r="2.4"/><path d="M15.8 14.2A4.5 4.5 0 0 1 21 18.5"/>',
    audio: '<path d="M4 9.5h3.5L12 6v12l-4.5-3.5H4z"/><path d="M15.5 9.5a3.5 3.5 0 0 1 0 5"/>'
  };
  // Per-bot glyph + color (original palette families; never teal). Matched by name; unknown bots get the generic robot.
  const BOTS = [
    { re: /\bcso\b|chief\s+(of\s+)?staff/i, c: '#a98bff', g: '<circle cx="12" cy="12" r="9"/><path d="m15.6 8.4-2.2 5-5 2.2 2.2-5z"/>' },
    { re: /builder|\bcdo\b/i, c: 'var(--acc)', g: '<path d="M14 6 4.5 15.5l4 4L18 10"/><path d="M12.5 4.5 15 2l7 7-2.5 2.5z"/>' },
    { re: /operator|\bcoo\b/i, c: 'var(--grn)', g: '<circle cx="12" cy="12" r="9"/><circle cx="12" cy="12" r="2.2"/><path d="M3.4 10.6 9.9 12M20.6 10.6 14.1 12M12 14.2V21"/>' },
    { re: /research/i, c: '#f07ab0', g: '<circle cx="10.5" cy="10.5" r="6"/><path d="m15 15 6 6"/>' },
    { re: /home/i, c: 'var(--eff-lab)', g: '<path d="M3 11.5 12 4l9 7.5"/><path d="M5.5 10v10h13V10"/><path d="M10 20v-5.5h4V20"/>' },
    { re: /inbox|triage/i, c: 'var(--lime)', g: '<path d="M3 13h5l1.5 3h5L16 13h5"/><path d="M5.5 5h13l2.5 8v6H3v-6z"/>' }
  ];
  const GENERIC = { c: 'var(--mut)', g: '<rect x="5" y="8.5" width="14" height="10.5" rx="3"/><path d="M12 4.5v4M9.5 13.2v.6M14.5 13.2v.6"/>' };
  const botStyle = name => BOTS.find(b => b.re.test(name || '')) || GENERIC;

  function reports() {
    const r = (typeof S !== 'undefined' && S.meta && Array.isArray(S.meta.daily_reports)) ? S.meta.daily_reports : [];
    return r.filter(x => x && /^\d{4}-\d{2}-\d{2}$/.test(x.date || '')).slice().sort((a, b) => b.date < a.date ? -1 : b.date > a.date ? 1 : 0);
  }
  function cur(reps) {
    let i = reps.findIndex(r => r.date === DAILY.date);
    if (i < 0) { i = 0; DAILY.date = reps.length ? reps[0].date : null; }
    return i;
  }
  const dparts = d => { const [y, m, dd] = d.split('-').map(Number); return { y, m, dd, dow: new Date(y, m - 1, dd).getDay() }; };
  const longDate = d => { const p = dparts(d); return `${DOW[p.dow]}, ${MON[p.m - 1].slice(0, 3)} ${p.dd}, ${p.y}`; };
  function dayHours(r) {
    if (typeof r.total_hours === 'number') return { v: r.total_hours, est: false };
    const k = (r.team || []).filter(t => typeof t.hours === 'number');
    return k.length ? { v: k.reduce((s, t) => s + t.hours, 0), est: true } : null;
  }
  const items = (a, cls) => `<ul class="dr-ul${cls ? ' ' + cls : ''}">${a.map(x => `<li>${e(x)}</li>`).join('')}</ul>`;
  const head = (ico, title, extra) => `<div class="dr-shd">${svg(ICO[ico])}<span class="dr-stitle">${title}</span>${extra || ''}</div>`;

  /* ---------- audio ---------- */
  function stopDailyAudio() {
    const p = window.REPORT && REPORT.players && REPORT.players.daily;
    if (p) { try { p.el.pause(); } catch (x) {} delete REPORT.players.daily; }
  }
  window.stopDailyAudio = stopDailyAudio;
  async function loadAudio(r) {
    if (DAILY.blobs[r.date]) return DAILY.blobs[r.date];
    if (!DAILY.loading[r.date]) DAILY.loading[r.date] = (async () => {
      const res = await fetch(r.audio.file, { cache: 'force-cache' });
      if (!res.ok) throw new Error('audio ' + res.status);
      const buf = await res.arrayBuffer();
      const k = await crypto.subtle.importKey('raw', S.key, 'AES-GCM', false, ['decrypt']);
      const mp3 = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: new Uint8Array(buf, 0, 12) }, k, new Uint8Array(buf, 12));
      return (DAILY.blobs[r.date] = URL.createObjectURL(new Blob([mp3], { type: 'audio/mpeg' })));
    })().finally(() => { delete DAILY.loading[r.date]; });
    return DAILY.loading[r.date];
  }
  function playerAudio(r) {
    const a = r.audio || {};
    const dur = a.duration_s || 0;
    const label = dur && typeof fmtTime === 'function' ? fmtTime(dur) : '';
    return { title: 'Daily briefing', file: DAILY.blobs[r.date] || '', label, duration_s: dur, script: a.script || [], timing: 'cues' };
  }
  function playerHtml(r) {
    if (typeof rpPlayer !== 'function') return '';
    if (!r.audio || !(r.audio.script || []).length) return `<div class="dr-player">${rpPlayer('daily', { title: 'Daily briefing', unavailable: true, script: [] })}</div>`;
    let h = rpPlayer('daily', playerAudio(r));
    if (!DAILY.blobs[r.date]) h = h.replace(' src=""', '');
    return `<div class="dr-player">${h}</div>`;
  }
  function bindDailyPlayer(main, r) {
    const root = main.querySelector('.rp-player[data-audio="daily"]');
    if (!root || !r.audio || root.classList.contains('rp-player-off') || typeof bindPlayer !== 'function') return;
    const audio = playerAudio(r);
    bindPlayer(root, audio);
    if (audio.file) return;
    const btn = root.querySelector('.rp-play'); btn.disabled = true; root.classList.add('dr-loading');
    loadAudio(r).then(url => {
      if (!root.isConnected) return;
      audio.file = url; root.querySelector('audio').src = url;
      btn.disabled = false; root.classList.remove('dr-loading');
    }).catch(err => {
      console.warn('daily audio', err);
      root.classList.remove('dr-loading'); root.classList.add('rp-player-off');
      const t = root.querySelector('.rp-total'); if (t) t.textContent = 'Audio unavailable';
    });
  }

  /* ---------- day view (v79: filled cards, Automation-style icon badges, grey uppercase labels) ---------- */
  const badge = (ico, color, cls) => `<span class="dr-badge${cls ? ' ' + cls : ''}" style="background:${color}">${svg(ICO[ico] || ico)}</span>`;
  const cardHd = (ico, color, title, right, cls) => `<div class="dr-chd">${badge(ico, color, cls)}<span class="dr-ctitle">${title}</span>${right ? `<span class="dr-cright">${right}</span>` : ''}</div>`;
  const lab = (t, note) => `<div class="dr-lab"><span>${t}</span>${note ? `<span class="dr-labnote">${note}</span>` : ''}</div>`;
  function overview(r) {
    const h = dayHours(r), bots = (r.team || []).filter(t => t && t.bot).length, nr = L(r.requested).length;
    const chips = [bots ? `<span class="dr-chip">${bots} bot${bots > 1 ? 's' : ''}</span>` : '',
      nr ? `<span class="dr-chip">${nr} request${nr > 1 ? 's' : ''}</span>` : '',
      r.sample ? '<span class="dr-chip">Sample</span>' : ''].join('');
    const b = L(r.blockers), q = L(r.open_questions);
    const rows = (arr, ico, color, label) => arr.length ? `<div class="dr-rows"><div class="dr-rowlab" style="color:${color}">${label}</div>${arr.map(x =>
      `<div class="dr-row">${badge(ico, color, 'sm')}<span>${e(x)}</span></div>`).join('')}</div>` : '';
    return `<section class="dr-card">
      ${cardHd('overview', 'var(--acc)', 'Overview', h ? `${h.est ? 'est. ' : ''}${hrs(h.v)} h` : '')}
      <p class="dr-sum">${e(r.summary || 'No activity recorded')}</p>
      ${chips ? `<div class="dr-chips">${chips}</div>` : ''}
      ${rows(b, 'blocker', 'var(--red)', b.length > 1 ? `${b.length} blockers` : 'Blocker')}
      ${rows(q, 'question', 'var(--amb)', `Open question${q.length > 1 ? 's' : ''} for you`)}
    </section>`;
  }
  function suggestions(r) {
    const s = r.suggestions || {}, im = L(s.improvements), id = L(s.ideas);
    if (!im.length && !id.length) return '';
    return `<section class="dr-card">
      ${cardHd('bulb', 'var(--bolt)', 'Improvements &amp; Suggestions', '', 'dark')}
      ${im.length ? `<div class="dr-sub">Improvements</div>${items(im)}` : ''}
      ${id.length ? `<div class="dr-sub">New ideas</div>${items(id)}` : ''}
    </section>`;
  }
  function team(r) {
    const t = (r.team || []).filter(x => x && x.bot);
    if (!t.length) return '';
    return lab('Team') + t.map(x => {
      const st = botStyle(x.bot), done = L(x.done);
      return `<section class="dr-card">
        ${cardHd(st.g, st.c, e(x.bot), typeof x.hours === 'number' ? `${hrs(x.hours)} h` : '')}
        ${done.length ? items(done, 'dr-done') : ''}
      </section>`;
    }).join('');
  }
  function requests(r) {
    const q = L(r.requested);
    if (!q.length) return '';
    return lab('My Requests', 'Not in audio') + `<section class="dr-card">
      <ol class="dr-ol">${q.map(x => `<li>${e(x)}</li>`).join('')}</ol>
    </section>`;
  }

  /* ---------- archive ---------- */
  function archive(reps) {
    const months = [];
    for (const r of reps) { const k = r.date.slice(0, 7); let g = months[months.length - 1]; if (!g || g.k !== k) months.push(g = { k, items: [] }); g.items.push(r); }
    return `<div class="rp-sec"><b>Archive</b></div>` + months.map(g => {
      const [y, m] = g.k.split('-').map(Number);
      const tot = g.items.reduce((s, r) => { const h = dayHours(r); return s + (h ? h.v : 0); }, 0);
      return `<div class="dr-amon"><span>${MON[m - 1]} ${y}</span><span class="dr-amonmeta">${g.items.length} day${g.items.length > 1 ? 's' : ''}${tot ? ` · ${hrs(tot)} h` : ''}</span></div>` +
        g.items.map(r => {
          const p = dparts(r.date), h = dayHours(r);
          return `<button type="button" class="rp-wk dr-arow${r.date === DAILY.date ? ' cur' : ''}" data-date="${e(r.date)}">
            <div><b>${DOW[p.dow]}, ${MON[p.m - 1].slice(0, 3)} ${p.dd}</b><span class="dr-asum">${e(r.summary || 'No activity recorded')}</span></div>
            <div class="dr-aright">${h ? `<span class="dr-hrs">${h.est ? 'est. ' : ''}${hrs(h.v)} h</span>` : ''}${r.audio ? svg(ICO.audio, 'dr-ico dr-aud') : ''}</div>
          </button>`;
        }).join('');
    }).join('');
  }

  window.renderDaily = function () {
    const main = document.getElementById('main');
    if (!main) return;
    setDailyChrome(); setDailyTitle();
    const reps = reports();
    if (!reps.length) {
      main.innerHTML = `<div class="dr-empty"><div class="dr-empty-t">No reports yet</div><p>Each evening's team report will appear here: an audio briefing, what each bot did, blockers, open questions, suggestions and your requests.</p></div>`;
      return;
    }
    if (DAILY.archive) { stopDailyAudio(); main.innerHTML = `<div class="dr-wrap">${archive(reps)}</div>`; return; }
    const r = reps[cur(reps)];
    main.innerHTML = `<div class="dr-wrap">${playerHtml(r)}${overview(r)}${suggestions(r)}${team(r)}${requests(r)}</div>`;
    bindDailyPlayer(main, r);
  };
  window.setDailyTitle = function () {
    const reps = reports(), i = cur(reps), prev = document.getElementById('prev'), next = document.getElementById('next');
    const t = document.getElementById('title');
    if (t) t.textContent = reps.length ? longDate(reps[i].date) : '';
    if (prev) prev.disabled = !reps.length || DAILY.archive || i >= reps.length - 1;   // ‹ = older
    if (next) next.disabled = !reps.length || DAILY.archive || i <= 0;                  // › = newer
  };
  window.moveDaily = function (dir) {
    if (DAILY.archive) return;
    const reps = reports(), n = cur(reps) - dir;
    if (n < 0 || n >= reps.length) return;
    stopDailyAudio(); DAILY.date = reps[n].date; renderDaily(); window.scrollTo(0, 0);
  };
  window.handleDailyClick = function (ev) {
    const row = ev.target.closest('.dr-arow');
    if (row) { stopDailyAudio(); DAILY.date = row.dataset.date; DAILY.archive = false; renderDaily(); window.scrollTo(0, 0); }
  };
  window.setDailyChrome = function () {
    const app = document.getElementById('app'), on = (typeof S !== 'undefined' && S.mode === 'daily');
    if (app) { app.classList.toggle('mode-daily', on); app.classList.toggle('dr-arch', on && DAILY.archive); }
    const h = document.getElementById('dailyhead');
    if (h) h.classList.toggle('hidden', !on);
    const a = document.getElementById('dailyarchive');
    if (a) {
      a.classList.toggle('on', DAILY.archive);
      if (!a.dataset.bound) {
        a.dataset.bound = '1';
        a.addEventListener('click', () => { if (S.mode !== 'daily') return; DAILY.archive = !DAILY.archive; renderDaily(); window.scrollTo(0, 0); });
      }
    }
    const sub = document.getElementById('dailysub');
    if (sub) { const n = reports().length; sub.textContent = n ? `Team activity · ${n} day${n > 1 ? 's' : ''}` : ''; }
  };
})();
