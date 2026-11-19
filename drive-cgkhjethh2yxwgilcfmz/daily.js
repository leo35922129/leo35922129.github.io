/* Daily Reports tab. Data: S.meta.daily_reports (inside the encrypted payload), newest first.
   Months are collapsible (newest open); day cards are collapsed and their body is only built when opened. */
(function () {
  const DAILY = window.DAILY = { openMonths: null, openDays: new Set() };
  const e = s => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const MON = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
  const DOW = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
  const hrs = v => (Math.round(v * 10) / 10).toString();
  function reports() {
    const r = (window.S && S.meta && Array.isArray(S.meta.daily_reports)) ? S.meta.daily_reports : [];
    return r.filter(x => x && /^\d{4}-\d{2}-\d{2}$/.test(x.date || '')).slice().sort((a, b) => b.date < a.date ? -1 : b.date > a.date ? 1 : 0);
  }
  function dayHours(r) {
    if (typeof r.total_hours === 'number') return { v: r.total_hours, est: false };
    const k = (r.team || []).filter(t => typeof t.hours === 'number');
    return k.length ? { v: k.reduce((s, t) => s + t.hours, 0), est: true } : null;
  }
  const L = a => Array.isArray(a) ? a.filter(x => typeof x === 'string' && x.trim()) : [];
  function hasBody(r) {
    const s = r.suggestions || {};
    return L(r.requested).length || (r.team || []).some(t => t && (t.bot || L(t.done).length)) || L(r.blockers).length ||
      L(r.open_questions).length || L(s.improvements).length || L(s.ideas).length;
  }
  const list = a => `<ul class="dr-ul">${a.map(x => `<li>${e(x)}</li>`).join('')}</ul>`;
  const sec = (title, inner, cls) => inner ? `<section class="dr-sec${cls ? ' ' + cls : ''}"><h4>${title}</h4>${inner}</section>` : '';
  function body(r) {
    const s = r.suggestions || {};
    const team = (r.team || []).filter(t => t && t.bot).map(t =>
      `<div class="dr-bot"><div class="dr-bothd"><b>${e(t.bot)}</b>${typeof t.hours === 'number' ? `<span class="dr-h">${hrs(t.hours)} h</span>` : ''}</div>${L(t.done).length ? list(L(t.done)) : ''}</div>`).join('');
    const sugg = (L(s.improvements).length ? `<div class="dr-sublab">Improvements</div>${list(L(s.improvements))}` : '') +
      (L(s.ideas).length ? `<div class="dr-sublab">New ideas</div>${list(L(s.ideas))}` : '');
    return `<div class="dr-body">
      ${sec('Requested by Lei', L(r.requested).length ? list(L(r.requested)) : '')}
      ${sec('What the team did', team)}
      ${sec('Blockers', L(r.blockers).length ? list(L(r.blockers)) : '', 'warn')}
      ${sec('Open questions for Lei', L(r.open_questions).length ? list(L(r.open_questions)) : '', 'ask')}
      ${sec('Suggestions', sugg, 'sugg')}
    </div>`;
  }
  function dayCard(r) {
    const [y, m, d] = r.date.split('-').map(Number);
    const dt = new Date(y, m - 1, d);
    const h = dayHours(r), can = !!hasBody(r), open = can && DAILY.openDays.has(r.date);
    const nq = L(r.open_questions).length, nb = L(r.blockers).length;
    const flags = (nb ? `<span class="dr-flag warn">${nb} blocker${nb > 1 ? 's' : ''}</span>` : '') + (nq ? `<span class="dr-flag ask">${nq} question${nq > 1 ? 's' : ''}</span>` : '');
    const head = `<div class="dr-date"><span class="dr-dow">${DOW[dt.getDay()]}</span> ${MON[m - 1].slice(0, 3)} ${d}${r.sample ? ' <span class="dr-flag">Sample</span>' : ''}</div>
      <div class="dr-sum">${e(r.summary || (can ? '' : 'No activity recorded'))}</div>
      ${flags ? `<div class="dr-flags">${flags}</div>` : ''}`;
    const right = `<div class="dr-right">${h ? `<span class="dr-hrs">${h.est ? 'est. ' : ''}${hrs(h.v)} h</span>` : ''}${can ? '<span class="dr-chev" aria-hidden="true"></span>' : ''}</div>`;
    return `<article class="dr-day${open ? ' open' : ''}${can ? '' : ' compact'}" data-date="${e(r.date)}">
      ${can ? `<button type="button" class="dr-dayhd" aria-expanded="${open}"><div class="dr-left">${head}</div>${right}</button>`
            : `<div class="dr-dayhd"><div class="dr-left">${head}</div>${right}</div>`}
      ${open ? body(r) : ''}
    </article>`;
  }
  window.renderDaily = function () {
    const main = document.getElementById('main');
    if (!main) return;
    const reps = reports();
    if (!reps.length) {
      main.innerHTML = `<div class="dr-empty"><div class="dr-empty-t">No reports yet</div><p>Each evening's team report will appear here: what you asked for, what each bot did, blockers, open questions and suggestions.</p></div>`;
      return;
    }
    const months = [];
    for (const r of reps) { const k = r.date.slice(0, 7); let g = months[months.length - 1]; if (!g || g.k !== k) months.push(g = { k, items: [] }); g.items.push(r); }
    if (!DAILY.openMonths) DAILY.openMonths = new Set([months[0].k]);
    main.innerHTML = `<div class="dr-wrap">${months.map(g => {
      const [y, m] = g.k.split('-').map(Number), open = DAILY.openMonths.has(g.k);
      const tot = g.items.reduce((s, r) => { const h = dayHours(r); return s + (h ? h.v : 0); }, 0);
      return `<section class="dr-month${open ? ' open' : ''}" data-month="${g.k}">
        <button type="button" class="dr-monhd" aria-expanded="${open}"><span class="dr-monname">${MON[m - 1]} ${y}</span>
          <span class="dr-monmeta">${g.items.length} day${g.items.length > 1 ? 's' : ''}${tot ? ` · ${hrs(tot)} h` : ''}</span><span class="dr-chev" aria-hidden="true"></span></button>
        ${open ? `<div class="dr-days">${g.items.map(dayCard).join('')}</div>` : ''}
      </section>`;
    }).join('')}</div>`;
  };
  window.handleDailyClick = function (ev) {
    const mh = ev.target.closest('.dr-monhd');
    if (mh) { const k = mh.closest('.dr-month').dataset.month; DAILY.openMonths.has(k) ? DAILY.openMonths.delete(k) : DAILY.openMonths.add(k); renderDaily(); return; }
    const dh = ev.target.closest('button.dr-dayhd');
    if (dh) { const d = dh.closest('.dr-day').dataset.date; DAILY.openDays.has(d) ? DAILY.openDays.delete(d) : DAILY.openDays.add(d); renderDaily(); }
  };
  window.setDailyChrome = function () {
    const app = document.getElementById('app'), on = !!(window.S && S.mode === 'daily');
    if (app) app.classList.toggle('mode-daily', on);
    const h = document.getElementById('dailyhead');
    if (h) h.classList.toggle('hidden', !on);
  };
})();
