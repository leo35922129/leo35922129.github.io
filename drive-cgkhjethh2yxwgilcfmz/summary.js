/* Report > Summary (v84). Data (encrypted payload): S.meta.usage_summary (Grok Bot hours, built from message timestamps)
   and S.meta.tesla_api (Fleet API calls/cost this month from the tracker's own logs). Uses daily.js helpers (window.DR). */
(function () {
  const SUM = window.SUMMARY = { daily: false, showDays: false };
  const MONL = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
  const DOWS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
  const e = s => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const H = v => v == null ? '–' : (v >= 10 ? v.toFixed(1) : v >= 1 ? v.toFixed(1) : v > 0 ? v.toFixed(2) : '0');
  const N = v => (v || 0).toLocaleString('en-US');
  const $m = v => '$' + (v || 0).toFixed(2);
  const dp = d => { const [y, m, dd] = d.split('-').map(Number); return { y, m, dd, dow: new Date(y, m - 1, dd).getDay() }; };
  const shortD = d => { const p = dp(d); return `${MONL[p.m - 1].slice(0, 3)} ${p.dd}`; };
  const longD = d => { const p = dp(d); return `${DOWS[p.dow]}, ${MONL[p.m - 1].slice(0, 3)} ${p.dd}, ${p.y}`; };
  const iso = dt => `${dt.getFullYear()}-${String(dt.getMonth() + 1).padStart(2, '0')}-${String(dt.getDate()).padStart(2, '0')}`;
  const timeET = ts => new Date(ts * 1000).toLocaleString('en-US', { timeZone: 'America/Detroit', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' }) + ' ET';
  const I = {
    chat: '<path d="M4 5h16v11H9.5L5 20v-4H4z"/><path d="M8 9.5h8M8 12.5h5"/>',
    bots: '<rect x="5" y="8.5" width="14" height="10.5" rx="3"/><path d="M12 4.5v4M9.5 13.2v.6M14.5 13.2v.6"/>',
    cost: '<circle cx="12" cy="12" r="9"/><path d="M14.8 9.2c-.5-1-1.5-1.5-2.8-1.5-1.6 0-2.8.8-2.8 2.1 0 3 5.8 1.6 5.8 4.4 0 1.3-1.3 2.1-3 2.1-1.4 0-2.5-.6-3-1.6M12 6v1.7M12 16.3V18"/>',
    calls: '<path d="M4 7h16M4 12h16M4 17h10"/>',
    free: '<circle cx="12" cy="12" r="9"/><path d="m8.5 12.3 2.4 2.4 4.8-5"/>',
    chart: '<path d="M4 20V4M4 20h16"/><path d="M8 16v-4M12 16V8M16 16v-6"/>',
    clock: '<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3.2 2"/>'
  };
  const usage = () => (S.meta && S.meta.usage_summary) || null;
  const api = () => (S.meta && S.meta.tesla_api) || null;
  const gapi = () => (S.meta && S.meta.google_api) || null;   // v130: Places API (New) counter from the Trips service

  /* ---------- Grok Bot usage ---------- */
  const secHd = (t, note) => `<div class="rp-sec dr-sec"><b>${t}</b>${note ? `<span class="dr-labnote">${note}</span>` : ''}</div>`;   // v126: News "Top stories" style
  function usageCards(u) {
    const D = window.DR;
    if (!u) return secHd('Grok Bot usage') + `<section class="dr-card su-empty"><p>Usage hours aren't available yet. They appear after the next nightly refresh.</p></section>`;
    const lei = u.lei || {}, days = (lei.daily || []).filter(d => d.hours > 0), first = lei.first_active || (days[0] || {}).date;
    const bots = (u.bots || []).filter(b => b && b.bot);
    const max = Math.max(0.01, ...bots.map(b => b.total_hours || 0));
    const comb = bots.reduce((s, b) => s + (b.total_hours || 0), 0);
    const rows = bots.map(b => {
      const st = D.botStyle(b.bot);
      return `<div class="su-bot">${D.badge(st.g, st.c, 'md bot')}
        <div class="su-bn"><div class="su-bt"><b>${e(b.bot)}</b><span class="su-bh">${H(b.total_hours)} h</span></div>
          <div class="su-bar"><i style="width:${Math.max(2, (b.total_hours || 0) / max * 100).toFixed(1)}%;background:${st.c}"></i></div>
          ${b.first_active ? `<div class="su-bs">Since ${shortD(b.first_active)}</div>` : ''}</div></div>`;
    }).join('');
    /* v126: top section in one indigo glow card (like Team Daily Reports); the rest below under News-style section headers */
    const a = api(), g = gapi();
    return `<div class="glowbot glow-indigo su-top">
      <section class="dr-card">
        ${D.cardHd(I.chat, 'var(--acc)', 'Your time with Grok Bot', '')}
        <div class="su-hero"><span class="su-big">${H(lei.total_hours)}</span><span class="su-unit">hours</span>${lei.rule ? '<span class="su-est">est.</span>' : ''}</div>
        <div class="su-meta">${first ? `Since ${longD(first)} · ` : ''}${days.length} active day${days.length === 1 ? '' : 's'}${lei.messages && lei.messages.sessions ? ` · ${N(lei.messages.sessions)} sessions` : ''}</div>
        ${lei.rule ? `<p class="su-rule">${e(lei.rule)}</p>` : ''}
      </section>
      <div class="su-tiles">
        <div class="su-tile"><span class="k">Bot hours</span><span class="v">${H(comb)} h</span></div>
        <div class="su-tile"><span class="k">Bots</span><span class="v">${bots.length}</span></div>
        <div class="su-tile pay"><span class="k">Tesla API</span><span class="v">${a ? $m(a.after_credit_projected) : '—'}</span></div>
        <div class="su-tile pay"><span class="k">Google API</span><span class="v">${g ? $m(g.projected) : '—'}</span></div>
      </div>
    </div>
      ${msgCard(lei.messages)}
      ${secHd('Team')}<section class="dr-card">
        ${D.cardHd(I.bots, 'var(--dim)', 'Bot working hours', '')}
        <div class="su-bots">${rows || '<p class="su-mut">No bot hours yet.</p>'}</div>
        ${bots.length > 1 ? `<div class="su-comb"><span>Combined bot hours</span><b>${H(comb)} h</b></div>
        <div class="su-cnote">Bots often work at the same time, so combined hours are more than clock time.</div>` : ''}
      </section>
      <button type="button" class="su-dailybtn" data-su="daily">${D.svg(I.clock, 'dr-ico')}<span>Daily time</span><svg class="su-chev" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="m9 6 6 6-6 6"/></svg></button>
      <p class="su-foot">Hours are estimates from message timestamps, not billed usage.${u.generated_at ? ` Updated ${e(timeET(Date.parse(u.generated_at) / 1000))}.` : ''}</p>`;
  }

  /* ---------- v140: messages Lei sent (his own messages only, from usage.json lei.messages) ---------- */
  const detroitDay = () => new Date().toLocaleDateString('en-CA', { timeZone: 'America/Detroit' });   // YYYY-MM-DD
  function msgCard(m) {
    if (!m || !m.total) return '';
    const D = window.DR, today = detroitDay(), p = dp(today);
    const mon = new Date(p.y, p.m - 1, p.dd - ((p.dow + 6) % 7)), wk = iso(mon), mo = today.slice(0, 7);   // week starts Monday
    const cnt = f => (m.daily || []).filter(d => f(d.date)).reduce((s, d) => s + (d.count || 0), 0);
    const t = { today: cnt(d => d === today), week: cnt(d => d >= wk && d <= today), month: cnt(d => d.slice(0, 7) === mo) };
    const max = Math.max(1, ...(m.by_bot || []).map(b => b.count || 0));
    const rows = (m.by_bot || []).filter(b => b.count > 0).map(b => { const st = D.botStyle(b.bot);
      return `<div class="su-bot">${D.badge(st.g, st.c, 'md bot')}
        <div class="su-bn"><div class="su-bt"><b>${e(b.bot)}</b><span class="su-bh">${N(b.count)}</span></div>
          <div class="su-bar"><i style="width:${Math.max(2, b.count / max * 100).toFixed(1)}%"></i></div></div></div>`; }).join('');
    return `${secHd('Messages you sent')}<section class="dr-card su-msg">
        ${D.cardHd(I.chat, 'var(--dim)', 'Your messages', `${N(m.total)} total`)}
        <div class="su-tiles">
          <div class="su-tile"><span class="k">Today</span><span class="v">${N(t.today)}</span></div>
          <div class="su-tile"><span class="k">This week</span><span class="v">${N(t.week)}</span></div>
          <div class="su-tile"><span class="k">This month</span><span class="v">${N(t.month)}</span></div>
          <div class="su-tile"><span class="k">All time</span><span class="v">${N(m.total)}</span></div>
        </div>
        ${rows ? `<div class="su-bots">${rows}</div>` : ''}
        <div class="su-cnote">Only messages you typed or said to a bot. Bot replies, routines and bot-to-bot messages aren't counted. The week starts Monday.</div>
      </section>`;
  }

  /* ---------- Tesla Fleet API ---------- */
  function apiCards(a) {
    const D = window.DR;
    if (!a) return secHd('Tesla Fleet API') + `<section class="dr-card su-empty"><p>Tesla API usage isn't available right now.</p></section>`;
    const [y, m] = a.month.split('-').map(Number), mon = MONL[m - 1], P = a.pricing || {};
    const cats = a.cats || [], billable = cats.reduce((s, c) => s + (c.n || 0), 0);
    const price = { device_data: '$1 / 500', commands: '$1 / 1,000', wakes: '$1 / 50', signals: '$1 / 150,000' };
    const crow = c => `<div class="su-crow">
        <div class="su-cl"><b>${e(c.label)}${c.basis === 'estimate' ? ' <span class="su-est">est.</span>' : ''}</b><span>${e(price[c.key] || '')} · ${e(catNote(c, a))}</span></div>
        <div class="su-cr"><b>${N(c.n)}</b><span>${$m(c.cost)}</span></div></div>`;
    const free = (a.free || []).map(f => `<div class="su-crow">
        <div class="su-cl"><b>${e(f.label)}</b><span>${f.failed ? `${N(f.ok)} OK, ${N(f.failed)} failed in a Nov 11–12 retry loop (fixed Nov 12)` : 'Connectivity check before polling or a command'}</span></div>
        <div class="su-cr"><b>${N(f.n)}</b><span>$0.00</span></div></div>`).join('') + `<div class="su-crow">
        <div class="su-cl"><b>Tessie</b><span>Status cache and nightly trip backfill: flat Tessie subscription, not billed per call</span></div>
        <div class="su-cr"><span>Not counted</span></div></div>`;
    const credit = P.credit || 10, under = a.projected <= credit;
    return secHd('Tesla Fleet API', `${mon} ${y}`) + `
      <section class="dr-card su-api">
        ${D.cardHd(I.cost, 'var(--grn)', 'Cost this month', '')}
        <div class="su-tiles">
          <div class="su-tile"><span class="k">To date</span><span class="v">${$m(a.cost_to_date)}</span></div>
          <div class="su-tile"><span class="k">Projected ${mon.slice(0, 3)}</span><span class="v">${$m(a.projected)}</span></div>
          <div class="su-tile pay"><span class="k">You pay</span><span class="v">${$m(a.after_credit_projected)}</span></div>
        </div>
        <p class="su-say">${under ? `Tesla's $${credit} monthly credit covers it. At the current rate of about ${$m(a.rate_per_day)} a day, ${mon} comes to ${$m(a.projected)}, so you pay $0.00.`
          : `At about ${$m(a.rate_per_day)} a day, ${mon} comes to ${$m(a.projected)}. After Tesla's $${credit} credit you pay ${$m(a.after_credit_projected)}.`}</p>
      </section>
      <section class="dr-card">
        ${D.cardHd(I.calls, 'var(--acc)', 'Billable calls', `${N(billable)}`)}
        ${cats.map(crow).join('')}
      </section>
      <section class="dr-card">
        ${D.cardHd(I.free, 'var(--dim)', 'Not billed', '')}
        ${free}
      </section>
      ${perDay(a)}
      <p class="su-foot">Pricing from Tesla: data $1 per 500 requests, commands $1 per 1,000, wakes $1 per 50, streaming $1 per 150,000 signals, $${credit} monthly discount, requests with status codes below 500 are billed, charges rounded to $0.01. Vehicle state and charging history are listed as "not charged". Sources: <a href="${e(P.source)}" target="_blank" rel="noopener">developer.tesla.com</a>, <a href="${e(P.source_billing)}" target="_blank" rel="noopener">Billing and Limits</a>, <a href="${e(P.source_endpoints)}" target="_blank" rel="noopener">endpoint pricing categories</a> (checked ${e(shortD(P.checked || '2026-11-20'))}, ${e((P.checked || '').slice(0, 4))}).</p>
      <p class="su-foot">${footNotes(a)} Projection = month to date + the last 7 days' average × days left. Updated ${e(timeET(a.as_of))}.</p>`;
  }
  /* ---------- Google Places API (New), v130 ---------- */
  function googleCards(g) {
    const D = window.DR;
    if (!g) return secHd('Google Places API') + `<section class="dr-card su-empty"><p>Google API usage isn't available right now.</p></section>`;
    const [y, m] = g.month.split('-').map(Number), mon = MONL[m - 1], P = g.pricing || {};
    const since = g.tracked_since ? `tracked since ${shortD(g.tracked_since)}` : 'tracking starts with the next Trips lookup';
    const row = (k, note, v, sub) => `<div class="su-crow">
        <div class="su-cl"><b>${k}</b><span>${note}</span></div>
        <div class="su-cr"><b>${v}</b>${sub != null ? `<span>${sub}</span>` : ''}</div></div>`;
    const trial = P.trial_expires ? longD(P.trial_expires).replace(/^\w+, /, '') : 'Feb 20, 2027';
    return secHd('Google Places API', `${mon} ${y}`) + `
      <section class="dr-card su-api">
        ${D.cardHd(I.cost, 'var(--grn)', 'Cost this month', '')}
        <div class="su-tiles">
          <div class="su-tile"><span class="k">To date</span><span class="v">${$m(g.cost_to_date)}</span></div>
          <div class="su-tile"><span class="k">Projected ${mon.slice(0, 3)}</span><span class="v">${$m(g.projected)}</span></div>
          <div class="su-tile pay"><span class="k">Free left</span><span class="v">${N(g.free_left)}</span></div>
        </div>
        <p class="su-say">${N(g.month_calls)} of ${N(P.free_per_month || 1000)} free Text Search calls used this month. At this pace ${mon} comes to about ${N(g.projected_calls)} calls, so it costs ${$m(g.projected)}. The server stops at ${N(g.month_cap)} a month, below the free ${N(P.free_per_month || 1000)}, so it can't go over.</p>
      </section>
      <section class="dr-card">
        ${D.cardHd(I.calls, 'var(--acc)', 'Calls', `${N(g.month_calls)}`)}
        ${row('Today', `server cap ${N(g.day_cap)} a day`, N(g.today), `of ${N(g.day_cap)}`)}
        ${row('This month', `server cap ${N(g.month_cap)} a month`, N(g.month_calls), `of ${N(g.month_cap)}`)}
        ${row('Cache hits', `answered from the ${P.cache_days || 7}-day cache, no Google call · ${e(since)}`, g.cache_hits_month == null ? '–' : N(g.cache_hits_month), '$0.00')}
        ${row('Free allowance', `${e(P.sku || 'Places API (New) Text Search Enterprise')}: ${N(P.free_per_month || 1000)} free a month, then $${P.per_1000 || 35} per 1,000`, N(g.free_left), 'left')}
      </section>
      <p class="su-foot">Free Trial $${(P.trial_credit || 300).toFixed(0)} credit expires ${e(trial)} · $${(P.budget_alert || 1).toFixed(0)} budget alert set. Calls are counted on the server before each request, failed ones included; repeat searches within ${P.cache_days || 7} days come from the cache. ${g.last_call ? `Last Google call ${e(timeET(Date.parse(g.last_call) / 1000))}. ` : ''}Updated ${e(timeET(g.as_of))}.</p>`;
  }
  function catNote(c, a) {
    if (c.key === 'device_data') return 'fallback polls + 1 read after each command';
    if (c.key === 'commands') return 'remote commands, failed ones included';
    if (c.key === 'wakes') return a.logging && a.logging.droplet_cli_since ? 'logged since Nov 20' : 'logged from Nov 20';
    if (c.key === 'signals') return c.n_est ? `${N(c.n_est)} estimated, ${N(c.n_logged)} logged` : 'logged';
    return '';
  }
  function footNotes(a) {
    const out = [];
    const s = (a.cats || []).find(c => c.key === 'signals');
    if (s && s.n_est) out.push('Streaming signals before Nov 20 weren\'t logged; they are estimated from the stored stream samples (changed fields per record).');
    if (a.wake_bound_before_log) out.push(`Wakes weren't logged before Nov 20; at most ${a.wake_bound_before_log} commands could have needed one (no more than ${$m(a.wake_bound_before_log * 0.02)}).`);
    out.push('Calls made from the box command line are logged from Nov 20.');
    return out.join(' ');
  }
  function perDay(a) {
    const D = window.DR, rows = (a.daily || []).filter(x => x.date >= (a.daily.find(x => x.cost > 0) || {}).date);
    if (!rows.length) return '';
    const max = Math.max(...rows.map(x => x.cost), 0.0001);
    const bars = rows.map(x => `<div class="su-col${x.est ? ' est' : ''}" title="${e(shortD(x.date))} ${$m(x.cost)}"><i style="height:${Math.max(2, x.cost / max * 100).toFixed(1)}%"></i></div>`).join('');
    const list = SUM.showDays ? `<div class="su-days">${rows.slice().reverse().map(x => `<div class="su-drow"><span class="d">${e(shortD(x.date))}</span>
        <span class="c">${N(x.device_data)} data · ${N(x.commands)} cmd${x.wakes ? ` · ${N(x.wakes)} wake` : ''} · ${N(x.signals + x.signals_est)} signals${x.est ? ' (est.)' : ''}</span><b>${$m(x.cost)}</b></div>`).join('')}</div>` : '';
    return `<section class="dr-card">
      ${D.cardHd(I.chart, 'var(--acc)', 'Per day', `max ${$m(max)}`)}
      <div class="su-chart">${bars}</div>
      <div class="su-axis"><span>${e(shortD(rows[0].date))}</span><span>${e(shortD(rows[rows.length - 1].date))}</span></div>
      <button type="button" class="su-more" data-su="days">${SUM.showDays ? 'Hide days' : 'Show each day'}</button>
      ${list}
    </section>`;
  }

  /* ---------- Daily time ---------- */
  function dailyTime(u) {
    const D = window.DR;
    if (!u) return `<section class="dr-card su-empty"><p>Usage hours aren't available yet.</p></section>`;
    const lei = u.lei || {}, bots = (u.bots || []).filter(b => b && b.bot);
    const start = lei.first_active || u.first_day, today = iso(new Date());
    const range = []; for (let d = new Date(start + 'T12:00:00'); iso(d) <= today; d.setDate(d.getDate() + 1)) range.push(iso(d));
    const map = arr => Object.fromEntries((arr || []).map(x => [x.date, x.hours]));
    const L = map(lei.daily), B = bots.map(b => ({ b, st: D.botStyle(b.bot), h: map(b.daily) }));
    const lmax = Math.max(0.01, ...range.map(d => L[d] || 0));
    const bsum = d => B.reduce((s, x) => s + (x.h[d] || 0), 0), bmax = Math.max(0.01, ...range.map(bsum));
    const leiBars = range.map(d => `<div class="su-col"><i style="height:${((L[d] || 0) / lmax * 100).toFixed(1)}%"></i></div>`).join('');
    const botBars = range.map(d => `<div class="su-col stack">${B.map(x => x.h[d] ? `<i style="height:${(x.h[d] / bmax * 100).toFixed(1)}%;background:${x.st.c}"></i>` : '').join('')}</div>`).join('');
    const axis = `<div class="su-axis"><span>${e(shortD(range[0]))}</span><span>${e(shortD(range[range.length - 1]))}</span></div>`;
    const legend = `<div class="su-legend">${B.map(x => `<span><i style="background:${x.st.c}"></i>${e(x.b.bot)}</span>`).join('')}</div>`;
    const all = new Set([...(lei.daily || []).map(x => x.date)]); B.forEach(x => Object.keys(x.h).forEach(d => all.add(d)));
    const days = [...all].filter(d => (L[d] || 0) > 0 || bsum(d) > 0).sort().reverse();
    const list = days.map(d => `<div class="su-day">
        <div class="su-dhd"><b>${e(longD(d))}</b><span class="su-you">${L[d] ? `You ${H(L[d])} h` : 'You –'}</span></div>
        <div class="su-chips">${B.filter(x => x.h[d]).map(x => `<span class="su-chip">${D.badge(x.st.g, x.st.c, 'xs bot')}${e(x.b.bot)} <b>${H(x.h[d])} h</b></span>`).join('')}</div>
      </div>`).join('');
    return `
      <section class="dr-card">
        ${D.cardHd(I.chat, 'var(--acc)', 'Your hours per day', `peak ${H(lmax)} h`)}
        <div class="su-chart tall">${leiBars}</div>${axis}
      </section>
      <section class="dr-card">
        ${D.cardHd(I.bots, 'var(--dim)', 'Bot hours per day', `peak ${H(bmax)} h`)}
        <div class="su-chart tall">${botBars}</div>${axis}${legend}
      </section>
      ${D.lab('By day', `${days.length} days`)}
      <section class="dr-card su-daylist">${list || '<p class="su-mut">No days yet.</p>'}</section>
      <p class="su-foot">Hours are estimates from message timestamps, not billed usage. Bots overlap, so a day's bot hours can add up to more than clock time.</p>`;
  }

  window.renderUsageSummary = function (main) {
    main.innerHTML = `<div class="dr-wrap su-wrap">${SUM.daily ? dailyTime(usage()) : usageCards(usage()) + apiCards(api()) + googleCards(gapi())}</div>`;
  };
  window.handleSummaryClick = function (ev) {
    const b = ev.target.closest('[data-su]');
    if (!b) return;
    if (b.dataset.su === 'daily') { SUM.daily = true; renderDaily(); window.scrollTo(0, 0); }
    else if (b.dataset.su === 'days') { SUM.showDays = !SUM.showDays; renderDaily(); }
  };
})();
