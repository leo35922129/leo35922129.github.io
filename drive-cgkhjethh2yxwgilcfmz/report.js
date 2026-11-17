'use strict';

const PLAY_ICO = '<svg viewBox="0 0 24 24"><path d="M8 5.2v13.6l11-6.8z"/></svg>';
const PAUSE_ICO = '<svg viewBox="0 0 24 24"><path d="M6.5 5h4v14h-4zm7 0h4v14h-4z"/></svg>';
const CHEV_ICO = '<svg viewBox="0 0 24 24"><path d="M6.4 9.2 12 14.8l5.6-5.6 1.4 1.4L12 17.6 5 10.6z"/></svg>';
const CAL_ICO = '<svg viewBox="0 0 24 24"><path d="M8 3.2h1.8v1.6H8zm6.2 0H16v1.6h-1.8zM5.2 5.6h1.8V4.8h1.8v.8h6.2V4.8H17v.8h1.8A1.6 1.6 0 0 1 20.4 7.2v11.6a1.6 1.6 0 0 1-1.6 1.6H5.2a1.6 1.6 0 0 1-1.6-1.6V7.2A1.6 1.6 0 0 1 5.2 5.6zm0 5.2V18.8h13.6V10.8z"/></svg>';
const CLOCK_ICO = '<svg viewBox="0 0 24 24"><path d="M12 3.2A8.8 8.8 0 1 1 3.2 12 8.8 8.8 0 0 1 12 3.2zm0 1.8A7 7 0 1 0 19 12a7 7 0 0 0-7-7zm.8 3.2v4.15l3.1 1.85-.9 1.5L11 12.4V8.2z"/></svg>';
const RATES = [1, 1.5, 2];

const REPORT = {
  weeks: [],
  groups: [],
  idx: 0,
  gidx: 0,
  week: null,
  archive: false,
  ready: false,
  error: null,
  players: {},
  open: { summary: false, deep: false }
};

function fmtTime(s) {
  s = Math.max(0, s | 0);
  return (s / 60 | 0) + ':' + String(s % 60).padStart(2, '0');
}

function wordCount(t) {
  return (String(t || '').trim().match(/\S+/g) || []).length;
}

function splitScript(text) {
  const joined = String(text || '').split(/\n+/).map(s => s.trim()).filter(Boolean).join(' ');
  if (!joined) return [];
  return joined.split(/(?<=[.!?])\s+/).map(s => s.trim()).filter(Boolean);
}

function estimateCues(lines, duration) {
  const words = lines.map(wordCount);
  const total = words.reduce((a, b) => a + b, 0) || 1;
  const dur = duration > 0 ? duration : 0;
  let t = 0;
  return lines.map((text, i) => {
    const start = t;
    const end = dur ? (i === lines.length - 1 ? dur : t + dur * words[i] / total) : 0;
    t = end;
    return { t: text, start, end, words: words[i] };
  });
}

function applyOfficialCues(lines, cues, duration) {
  const n = Math.max(lines.length, (cues || []).length);
  const out = [];
  for (let i = 0; i < n; i++) {
    const c = (cues && cues[i]) || {};
    const t = (c.t != null && String(c.t).trim()) ? String(c.t).trim() : (lines[i] || '');
    if (!t) continue;
    const start = (c.start != null && isFinite(+c.start)) ? +c.start : null;
    const end = (c.end != null && isFinite(+c.end)) ? +c.end : null;
    out.push({ t, start, end, words: wordCount(t) });
  }
  for (let i = 0; i < out.length; i++) {
    if (out[i].start == null) out[i].start = i === 0 ? 0 : (out[i - 1].end != null ? out[i - 1].end : 0);
  }
  for (let i = 0; i < out.length; i++) {
    if (out[i].end == null) {
      out[i].end = (i < out.length - 1 && out[i + 1].start != null)
        ? out[i + 1].start
        : (duration || out[i].start);
    }
  }
  return out;
}

function buildAudio(kind, folder, report, scriptText, cueList) {
  const defaults = kind === 'summary'
    ? { file: 'summary.mp3', title: '3-min summary' }
    : { file: 'deep-dive.mp3', title: '10-min deep dive' };
  const a = (report.audio && report.audio[kind]) || {};
  if (a.unavailable) {
    const lines = splitScript(scriptText);
    return {
      unavailable: true,
      file: '',
      duration_s: 0,
      label: 'Audio coming',
      title: a.title || defaults.title,
      timing: 'none',
      script: estimateCues(lines, 0)
    };
  }
  const file = 'report/' + folder + '/' + (a.file || defaults.file);
  const lines = splitScript(scriptText);
  let official = Array.isArray(cueList) && cueList.length > 0;
  if (official && cueList.length !== lines.length) {
    console.warn('report cues: ' + kind + ' cue count (' + cueList.length + ') != script lines (' + lines.length + '); falling back to word-count timing');
    official = false;
  }
  const duration = (a.duration_s != null && isFinite(+a.duration_s)) ? +a.duration_s : 0;
  const script = official ? applyOfficialCues(lines, cueList, duration) : estimateCues(lines, duration);
  const label = a.label || (duration ? fmtTime(duration) : '–');
  return {
    file,
    duration_s: duration,
    label,
    title: a.title || defaults.title,
    timing: official ? 'cues' : 'word-count',
    script
  };
}

function pickCues(cuesFile, kind) {
  if (!cuesFile || typeof cuesFile !== 'object') return null;
  if (kind === 'summary') return cuesFile.summary || cuesFile['summary.mp3'] || null;
  return cuesFile.deep || cuesFile['deep-dive'] || cuesFile['deep-dive.mp3'] || cuesFile.deep_dive || null;
}

async function fetchText(url) {
  const r = await fetch(url, { cache: 'no-store' });
  if (!r.ok) throw new Error(url + ' ' + r.status);
  return r.text();
}

async function fetchJSON(url) {
  const r = await fetch(url, { cache: 'no-store' });
  if (!r.ok) throw new Error(url + ' ' + r.status);
  return r.json();
}

async function loadWeekEntry(entry) {
  const folder = entry.folder || entry.date;
  const base = 'report/' + folder + '/';
  const [report, content, summaryTxt, deepTxt, cues] = await Promise.all([
    fetchJSON(base + 'report.json'),
    fetchJSON(base + 'content.json'),
    fetchText(base + 'summary.txt').catch(() => ''),
    fetchText(base + 'deep-dive.txt').catch(() => ''),
    fetchJSON(base + 'cues.json').catch(() => null)
  ]);
  const audioMeta = report.audio || {};
  return {
    date: report.date || entry.date,
    window: report.window || entry.window || '',
    title: report.title || entry.title || '',
    source: report.source || entry.source || 'cio',
    source_label: report.source_label || entry.source_label || '',
    group: entry.group || report.group || report.date || entry.date,
    group_window: entry.group_window || report.group_window || report.window || entry.window || '',
    folder,
    lead: report.lead || '',
    src: report.src || {},
    headlines: content.headlines || [],
    watch: content.watch || [],
    robotaxi_table: content.robotaxi_table || { columns: [], rows: [] },
    adas_table: content.adas_table || { columns: [], rows: [] },
    deep: content.deep || [],
    before: content.before || [],
    analysis: content.analysis || [],
    tags_proposed: !!(content.tags_proposed || report.tags_proposed),
    audio: {
      summary: buildAudio('summary', folder, report, summaryTxt, pickCues(cues, 'summary') || (audioMeta.summary && audioMeta.summary.cues) || null),
      deep: buildAudio('deep', folder, report, deepTxt, pickCues(cues, 'deep') || (audioMeta.deep && audioMeta.deep.cues) || null)
    }
  };
}

function rpChips(ids, src) {
  const bits = [];
  for (const id of ids || []) {
    const rec = src && src[id];
    if (!rec) continue;
    const [label, url] = rec;
    bits.push(`<a class="rp-src" href="${esc(url)}" target="_blank" rel="noopener noreferrer">${esc(label)}</a>`);
  }
  return bits.length ? `<div class="rp-srcs">${bits.join('')}</div>` : '';
}

function rpTags(tags) {
  if (!tags || !tags.length) return '';
  return `<div class="rp-tags">${tags.map(t => {
    const cls = t.toLowerCase() === 'tesla' ? 'rp-tag tesla' : 'rp-tag';
    return `<span class="${cls}">${esc(t)}</span>`;
  }).join('')}</div>`;
}

function rpCell(cell, src) {
  if (cell && typeof cell === 'object') {
    return esc(cell.t || '') + rpChips(cell.s, src).replace('class="rp-srcs"', 'class="rp-srcs" style="margin-top:6px"');
  }
  return esc(String(cell ?? ''));
}

function isTeslaRow(row) {
  const first = row && row[0];
  if (first && typeof first === 'object' && first.operator_id != null && String(first.operator_id).trim() !== '') {
    return String(first.operator_id).toLowerCase() === 'tesla';
  }
  const text = first && typeof first === 'object' ? first.t : first;
  return String(text || '').toLowerCase().startsWith('tesla');
}

function rpStacked(table, src) {
  const cols = table.columns || [];
  return (table.rows || []).map(row => {
    const tesla = isTeslaRow(row) ? ' tesla' : '';
    const name = row[0] && typeof row[0] === 'object' ? row[0].t : row[0];
    const kvs = cols.slice(1).map((col, i) =>
      `<div class="rp-kv"><div class="k">${esc(col)}</div><div class="v">${rpCell(row[i + 1], src)}</div></div>`
    ).join('');
    return `<article class="rp-op${tesla}"><div class="oname">${esc(name)}</div><div class="kvs">${kvs}</div></article>`;
  }).join('');
}

function rpTable(table, src) {
  const cols = table.columns || [];
  const thead = '<tr>' + cols.map(c => `<th>${esc(c)}</th>`).join('') + '</tr>';
  const body = (table.rows || []).map(row => {
    const tesla = isTeslaRow(row) ? ' class="tesla"' : '';
    return `<tr${tesla}>${row.map(c => `<td>${rpCell(c, src)}</td>`).join('')}</tr>`;
  }).join('');
  return `<div class="rp-tw"><table><thead>${thead}</thead><tbody>${body}</tbody></table></div><p class="rp-hint">Swipe to see more columns</p>`;
}

function hasTable(table) {
  return !!(table && (table.columns || []).length && (table.rows || []).length);
}

function rpCompare(id, title, table, src) {
  return `<div class="rp-sechead">
    <div class="rp-sec"><b>${esc(title)}</b></div>
    <div class="rp-seg" data-rpseg="${esc(id)}" role="tablist">
      <button type="button" class="on" data-view="cards">Cards</button>
      <button type="button" data-view="table">Table</button>
    </div>
  </div>
  <div id="${esc(id)}">
    <div data-view="cards">${rpStacked(table, src)}</div>
    <div data-view="table" class="hidden">${rpTable(table, src)}</div>
  </div>`;
}

function rpPlayer(kind, audio) {
  const lines = (audio.script || []).map((c, i) =>
    `<div class="rp-line" data-i="${i}" data-start="${c.start || 0}">${esc(c.t)}</div>`
  ).join('');
  const open = REPORT.open[kind] ? ' open' : '';
  if (audio && audio.unavailable) {
    return `<article class="rp-player rp-player-off${open}" data-audio="${esc(kind)}">
    <div class="rp-row">
      <button type="button" class="rp-play" disabled aria-label="Audio coming">${PLAY_ICO}</button>
      <div class="rp-mid">
        <div class="rp-name">${esc(audio.title)}</div>
        <div class="rp-bar" aria-hidden="true">
          <div class="rp-track"><div class="rp-fill"></div></div>
        </div>
        <div class="rp-times">
          <span class="rp-elapsed">0:00</span>
          <button type="button" class="rp-speed" disabled>1x</button>
          <span class="rp-total">Audio coming</span>
        </div>
      </div>
      <button type="button" class="rp-chev" aria-label="Show script" aria-expanded="${REPORT.open[kind] ? 'true' : 'false'}">${CHEV_ICO}</button>
    </div>
    <div class="rp-script">${lines}</div>
  </article>`;
  }
  return `<article class="rp-player${open}" data-audio="${esc(kind)}">
    <audio preload="metadata" src="${esc(audio.file)}"></audio>
    <div class="rp-row">
      <button type="button" class="rp-play" aria-label="Play">${PLAY_ICO}</button>
      <div class="rp-mid">
        <div class="rp-name">${esc(audio.title)}</div>
        <div class="rp-bar" role="slider" aria-label="Seek" aria-valuemin="0" aria-valuemax="${audio.duration_s}">
          <div class="rp-track"><div class="rp-fill"></div></div>
        </div>
        <div class="rp-times">
          <span class="rp-elapsed">0:00</span>
          <button type="button" class="rp-speed" data-rate="1">1x</button>
          <span class="rp-total">${esc(audio.label)}</span>
        </div>
      </div>
      <button type="button" class="rp-chev" aria-label="Show script" aria-expanded="${REPORT.open[kind] ? 'true' : 'false'}">${CHEV_ICO}</button>
    </div>
    <div class="rp-script">${lines}</div>
  </article>`;
}

function defaultWeek(g) {
  if (!g || !g.weeks || !g.weeks.length) return null;
  return g.weeks.find(w => w.source === 'cio') || g.weeks[0];
}

function selectGroup(i, source) {
  if (i < 0 || i >= (REPORT.groups || []).length) return;
  REPORT.gidx = i;
  const g = REPORT.groups[i];
  REPORT.week = (source && g.weeks.find(w => w.source === source)) || defaultWeek(g);
  REPORT.idx = Math.max(0, REPORT.weeks.indexOf(REPORT.week));
}

function weekOf() {
  if (REPORT.week) return REPORT.week;
  const g = (REPORT.groups || [])[REPORT.gidx];
  return defaultWeek(g) || REPORT.weeks[REPORT.idx] || REPORT.weeks[0];
}

function syncReportChrome() {
  const origin = document.getElementById('rptorigin');
  const row = document.getElementById('rptsrcrow');
  const w = weekOf();
  const onNews = typeof S !== 'undefined' && S.mode === 'report';
  if (origin) origin.textContent = (onNews && !REPORT.archive) ? ((w && w.source_label) || '') : '';
  const g = (REPORT.groups || [])[REPORT.gidx];
  const multi = !!(onNews && g && g.weeks && g.weeks.length > 1 && !REPORT.archive);
  if (row) {
    row.hidden = !multi;
    row.classList.toggle('hidden', !multi);
    if (multi) {
      row.querySelectorAll('button[data-source]').forEach(b => {
        const present = g.weeks.some(x => x.source === b.dataset.source);
        b.hidden = !present;
        b.classList.toggle('on', !!(w && w.source === b.dataset.source));
      });
    }
  }
}

function switchReportSource(source) {
  const g = (REPORT.groups || [])[REPORT.gidx];
  if (!g || !g.weeks.some(w => w.source === source)) return;
  if (REPORT.week && REPORT.week.source === source) return;
  stopReportAudio();
  REPORT.open = { summary: false, deep: false };
  selectGroup(REPORT.gidx, source);
  renderReport();
}
window.switchReportSource = switchReportSource;
window.syncReportChrome = syncReportChrome;
window.weekOf = weekOf;

function renderReportArchive() {
  setModeClass();
  setTitle();
  const main = $('#main');
  const items = (REPORT.groups || []).map((g, i) => {
    const latest = i === REPORT.groups.length - 1;
    const window = g.group_window || (g.weeks[0] && (g.weeks[0].group_window || g.weeks[0].window)) || '';
    const bySrc = (s) => g.weeks.find(w => w.source === s);
    const ordered = [bySrc('cio'), bySrc('chatgpt')].filter(Boolean);
    const rest = g.weeks.filter(w => !ordered.includes(w));
    const sources = ordered.concat(rest);
    const sub = sources.length > 1
      ? ('Two sources' + (latest ? ' · latest' : ''))
      : ((sources[0] && (sources[0].source_label || sources[0].source)) || '') + (latest ? ' · latest' : '');
    const chips = sources.length > 1
      ? `<div class="rp-seg" data-archive-src="${i}" role="group" aria-label="Choose source">
          ${sources.map(w =>
            `<button type="button" data-source="${esc(w.source)}">${w.source === 'cio' ? 'CIO' : (w.source === 'chatgpt' ? 'ChatGPT' : esc(w.source))}</button>`
          ).join('')}
        </div>`
      : `<span class="rp-tag">${sources[0] && sources[0].source === 'chatgpt' ? 'ChatGPT' : 'CIO'}</span>`;
    return `<div class="rp-wk" role="button" tabindex="0" data-group="${i}">
      <div><b>${esc(window)}</b><span>${esc(sub)}</span></div>
      ${chips}
    </div>`;
  }).join('');
  main.innerHTML = `<div class="rp-sec"><b>Archive</b></div>${items || '<div class="rp-empty">No reports yet.</div>'}`;
}

function renderReportBody(w) {
  const src = w.src || {};
  const heads = (w.headlines || []).map((h, i) => {
    const num = String(i + 1).padStart(2, '0');
    return `<article class="rp-hcard">
      <div class="hd"><div class="num">${num}</div><h2>${esc(h.h)}</h2></div>
      ${rpTags(h.tags)}
      <p class="body">${esc(h.t)}</p>
      <div class="rp-why"><span class="lab">Why it matters.</span> ${esc(h.why)}</div>
      ${rpChips(h.s, src)}
    </article>`;
  }).join('');

  const watch = (w.watch || []).map(it =>
    `<article class="rp-witem"><div class="rp-lico" aria-hidden="true">${CAL_ICO}</div><div>
      <div class="t">${esc(it.t)}</div>${rpTags(it.tags)}${rpChips(it.s, src)}
    </div></article>`
  ).join('');

  const before = (w.before || []).map(it =>
    `<article class="rp-bitem"><div class="rp-lico" aria-hidden="true">${CLOCK_ICO}</div><div>
      <div class="t">${esc(it.t)}</div>${rpTags(it.tags)}${rpChips(it.s, src)}
    </div></article>`
  ).join('');

  const deep = (w.deep || []).map((th, i) => {
    const items = (th.items || []).map(it =>
      `<div class="rp-ditem">${esc(it.t)}${rpChips(it.s, src)}</div>`
    ).join('');
    const open = i === 0 ? ' open' : '';
    return `<section class="rp-dbox${open}">
      <button type="button" class="rp-dtog" aria-expanded="${i === 0 ? 'true' : 'false'}">
        <span class="ml">${esc(th.h)}</span>
        <span class="chev">${CHEV_ICO}</span>
      </button>
      <div class="rp-dbody">${rpTags(th.tags)}${items}</div>
    </section>`;
  }).join('');

  const analysis = (w.analysis || []).map((p, i) =>
    `<div class="rp-apara"><div class="rp-anum">${i + 1}</div><p>${esc(typeof p === 'string' ? p : (p.t || ''))}</p></div>`
  ).join('');

  const sources = Object.values(src).map(([label, url]) =>
    `<a class="rp-src" href="${esc(url)}" target="_blank" rel="noopener noreferrer">${esc(label)}</a>`
  ).join('');

  return `
    ${rpPlayer('summary', w.audio.summary)}
    ${rpPlayer('deep', w.audio.deep)}
    <article class="rp-lead">${esc(w.lead)}</article>
    <div class="rp-sec"><b>Top stories</b></div>
    ${heads}
    ${hasTable(w.robotaxi_table) ? rpCompare('rp-robotaxi', 'Robotaxi comparison', w.robotaxi_table, src) : ''}
    ${hasTable(w.adas_table) ? rpCompare('rp-adas', 'Consumer ADAS', w.adas_table, src) : ''}
    ${watch ? '<div class="rp-sec"><b>What to watch</b></div>' + watch : ''}
    ${deep ? '<div class="rp-sec"><b>Deep dive</b></div>' + deep : ''}
    ${before ? '<div class="rp-sec"><b>Just before this week</b></div>' + before : ''}
    ${analysis ? '<div class="rp-sec"><b>Analysis</b></div>' + analysis : ''}
    <div class="rp-sec"><b>Sources</b></div>
    <div class="rp-srclist">${sources}</div>
  `;
}

function cueAt(script, t) {
  if (!script || !script.length) return -1;
  for (let i = 0; i < script.length; i++) {
    if (t >= script[i].start && t < script[i].end) return i;
  }
  if (t >= script[script.length - 1].start) return script.length - 1;
  return 0;
}

function bindPlayer(root, audio) {
  const kind = root.dataset.audio;
  const el = root.querySelector('audio');
  const playBtn = root.querySelector('.rp-play');
  const fill = root.querySelector('.rp-fill');
  const elapsed = root.querySelector('.rp-elapsed');
  const totalEl = root.querySelector('.rp-total');
  const bar = root.querySelector('.rp-bar');
  const speedBtn = root.querySelector('.rp-speed');
  const chev = root.querySelector('.rp-chev');
  let dur = audio.duration_s || 0;
  let lastCue = -1;

  const prev = REPORT.players[kind];
  const same = prev && prev.audio && prev.audio.file === audio.file;
  const savedTime = same && prev.el ? prev.el.currentTime : 0;
  const savedRate = same && prev.el ? prev.el.playbackRate : 1;
  const wasPlaying = same && prev.el && !prev.el.paused && !prev.el.ended;

  function setIcon(playing) {
    playBtn.innerHTML = playing ? PAUSE_ICO : PLAY_ICO;
    playBtn.setAttribute('aria-label', playing ? 'Pause' : 'Play');
  }

  function retargetLines() {
    root.querySelectorAll('.rp-line').forEach((n, i) => {
      if (audio.script[i]) n.dataset.start = audio.script[i].start;
    });
  }

  function highlight(t) {
    const i = cueAt(audio.script, t);
    if (i === lastCue) return;
    lastCue = i;
    root.querySelectorAll('.rp-line').forEach((n, j) => {
      const on = j === i;
      n.classList.toggle('on', on);
      if (on && root.classList.contains('open')) {
        const box = root.querySelector('.rp-script');
        const top = n.getBoundingClientRect().top - box.getBoundingClientRect().top + box.scrollTop
          - box.clientHeight / 2 + n.offsetHeight / 2;
        box.scrollTo({ top: Math.max(0, top), behavior: 'auto' });
      }
    });
  }

  function tick() {
    const t = el.currentTime || 0;
    const d = (el.duration && isFinite(el.duration) && el.duration > 0) ? el.duration : dur;
    elapsed.textContent = fmtTime(t);
    fill.style.width = (d ? (t / d * 100) : 0) + '%';
    highlight(t);
  }

  el.addEventListener('loadedmetadata', () => {
    if (el.duration && isFinite(el.duration) && el.duration > 0) {
      dur = el.duration;
      audio.duration_s = dur;
      totalEl.textContent = fmtTime(dur);
      if (audio.timing !== 'cues') {
        audio.script = estimateCues(audio.script.map(s => s.t), dur);
        retargetLines();
        lastCue = -1;
      }
      tick();
    }
  });
  el.addEventListener('timeupdate', tick);
  el.addEventListener('play', () => {
    document.querySelectorAll('.rp-player audio').forEach(a => { if (a !== el) a.pause(); });
    setIcon(true);
  });
  el.addEventListener('pause', () => setIcon(false));
  el.addEventListener('ended', () => { setIcon(false); tick(); });

  playBtn.addEventListener('click', () => { el.paused ? el.play() : el.pause(); });

  function seek(ev) {
    const r = bar.getBoundingClientRect();
    const x = (('touches' in ev && ev.touches[0]) ? ev.touches[0].clientX : ev.clientX) - r.left;
    const p = Math.min(1, Math.max(0, x / r.width));
    const d = (el.duration && isFinite(el.duration) && el.duration > 0) ? el.duration : dur;
    el.currentTime = p * d;
    tick();
  }
  let drag = false;
  bar.addEventListener('click', seek);
  bar.addEventListener('pointerdown', ev => { drag = true; seek(ev); bar.setPointerCapture(ev.pointerId); });
  bar.addEventListener('pointermove', ev => { if (drag) seek(ev); });
  bar.addEventListener('pointerup', () => { drag = false; });
  bar.addEventListener('pointercancel', () => { drag = false; });

  speedBtn.addEventListener('click', ev => {
    ev.stopPropagation();
    const cur = parseFloat(speedBtn.dataset.rate) || 1;
    const i = (RATES.indexOf(cur) + 1) % RATES.length;
    const rate = RATES[i];
    speedBtn.dataset.rate = String(rate);
    speedBtn.textContent = rate + 'x';
    el.playbackRate = rate;
  });

  chev.addEventListener('click', () => {
    const open = !root.classList.contains('open');
    root.classList.toggle('open', open);
    chev.setAttribute('aria-expanded', open ? 'true' : 'false');
    REPORT.open[kind] = open;
    if (open) highlight(el.currentTime || 0);
  });

  root.querySelectorAll('.rp-line').forEach(n => {
    n.addEventListener('click', () => {
      el.currentTime = parseFloat(n.dataset.start) || 0;
      tick();
      if (el.paused) el.play();
    });
  });

  if (savedRate && savedRate !== 1) {
    el.playbackRate = savedRate;
    speedBtn.dataset.rate = String(savedRate);
    speedBtn.textContent = savedRate + 'x';
  }
  if (savedTime) el.currentTime = savedTime;
  setIcon(false);
  tick();
  if (wasPlaying) el.play();

  REPORT.players[kind] = { el, tick, highlight, audio, root };
}

function bindReportClicks(main) {
  main.querySelectorAll('[data-rpseg]').forEach(seg => {
    const box = document.getElementById(seg.dataset.rpseg);
    if (!box) return;
    seg.querySelectorAll('button').forEach(b => b.addEventListener('click', () => {
      seg.querySelectorAll('button').forEach(x => x.classList.toggle('on', x === b));
      box.querySelectorAll('[data-view]').forEach(v => v.classList.toggle('hidden', v.dataset.view !== b.dataset.view));
    }));
  });
  main.querySelectorAll('.rp-dtog').forEach(btn => {
    btn.addEventListener('click', () => {
      const box = btn.closest('.rp-dbox');
      const open = !box.classList.contains('open');
      box.classList.toggle('open', open);
      btn.setAttribute('aria-expanded', open ? 'true' : 'false');
    });
  });
  main.querySelectorAll('.rp-wk').forEach(b => {
    const open = ev => {
      if (ev.target.closest('[data-archive-src]')) return;
      const i = +b.dataset.group;
      REPORT.archive = false;
      stopReportAudio();
      REPORT.open = { summary: false, deep: false };
      selectGroup(i);
      renderReport();
    };
    b.addEventListener('click', open);
    b.addEventListener('keydown', ev => {
      if (ev.key === 'Enter' || ev.key === ' ') { ev.preventDefault(); open(ev); }
    });
  });
  main.querySelectorAll('[data-archive-src] button[data-source]').forEach(btn => {
    btn.addEventListener('click', ev => {
      ev.preventDefault();
      ev.stopPropagation();
      const i = +btn.closest('[data-archive-src]').dataset.archiveSrc;
      REPORT.archive = false;
      stopReportAudio();
      REPORT.open = { summary: false, deep: false };
      selectGroup(i, btn.dataset.source);
      renderReport();
    });
  });
}

function stopReportAudio() {
  Object.values(REPORT.players).forEach(p => {
    try { p.el.pause(); } catch (e) {}
  });
  REPORT.players = {};
}

function moveReport(dir) {
  if (REPORT.archive) return;
  const n = REPORT.gidx + dir;
  if (n < 0 || n >= (REPORT.groups || []).length) return;
  stopReportAudio();
  REPORT.open = { summary: false, deep: false };
  selectGroup(n);
  renderReport();
}

function renderReport() {
  setModeClass();
  setTitle();
  const main = $('#main');
  const note = document.getElementById('effnote');
  if (note) { note.hidden = true; note.textContent = ''; }
  if (!REPORT.ready) {
    main.innerHTML = `<div class="rp-empty">${REPORT.error ? 'Could not load this week’s report.' : 'Loading report…'}</div>`;
    return;
  }
  if (REPORT.archive) {
    renderReportArchive();
    bindReportClicks(main);
    syncReportChrome();
    return;
  }
  const w = weekOf();
  if (!w) {
    main.innerHTML = '<div class="rp-empty">No reports yet.</div>';
    return;
  }
  main.innerHTML = renderReportBody(w);
  bindMaybePlayer(main.querySelector('.rp-player[data-audio="summary"]'), w.audio && w.audio.summary);
  bindMaybePlayer(main.querySelector('.rp-player[data-audio="deep"]'), w.audio && w.audio.deep);
  bindReportClicks(main);
  syncReportChrome();
}

window.renderReport = renderReport;

async function seekReport(kind, t) {
  const p = REPORT.players[kind];
  if (!p) return 0;
  const el = p.el;
  if (el.readyState < 1) {
    await new Promise(res => el.addEventListener('loadedmetadata', res, { once: true }));
  }
  try { await el.play(); el.pause(); } catch (e) {}
  el.currentTime = t;
  await new Promise(res => {
    const done = () => { el.removeEventListener('seeked', done); res(); };
    el.addEventListener('seeked', done);
    setTimeout(done, 1200);
  });
  p.tick();
  return el.currentTime;
}
window.seekReport = seekReport;
window.moveReport = moveReport;
window.stopReportAudio = stopReportAudio;
window.REPORT = REPORT;

async function loadReportData() {
  const r = await fetch('report/weeks.json?t=' + Date.now(), { cache: 'no-store' });
  if (!r.ok) throw new Error('weeks.json ' + r.status);
  const data = await r.json();
  const entries = data.weeks || [];
  REPORT.weeks = await Promise.all(entries.map(loadWeekEntry));
  const order = [];
  const map = {};
  for (const w of REPORT.weeks) {
    const id = w.group || w.date;
    if (!map[id]) { map[id] = []; order.push(id); }
    map[id].push(w);
  }
  REPORT.groups = order.map(id => ({
    id,
    weeks: map[id],
    group_window: (map[id][0] && map[id][0].group_window) || (map[id][0] && map[id][0].window) || ''
  }));
  REPORT.gidx = Math.max(0, REPORT.groups.length - 1);
  selectGroup(REPORT.gidx);
  REPORT.ready = true;
  REPORT.error = null;
}

function bindMaybePlayer(root, audio) {
  if (!root || !audio) return;
  if (audio.unavailable) {
    const chev = root.querySelector('.rp-chev');
    if (chev && !root.dataset.chevBound) {
      root.dataset.chevBound = '1';
      chev.addEventListener('click', () => {
        const open = !root.classList.contains('open');
        root.classList.toggle('open', open);
        chev.setAttribute('aria-expanded', open ? 'true' : 'false');
        REPORT.open[root.dataset.audio] = open;
      });
    }
    return;
  }
  bindPlayer(root, audio);
}

function wireReport() {
  const arch = $('#rptarchive');
  if (arch && !arch.dataset.bound) {
    arch.dataset.bound = '1';
    arch.addEventListener('click', () => {
      if (S.mode !== 'report') return;
      REPORT.archive = !REPORT.archive;
      if (REPORT.archive) stopReportAudio();
      renderReport();
    });
  }
  const row = document.getElementById('rptsrcrow');
  if (row && !row.dataset.bound) {
    row.dataset.bound = '1';
    row.addEventListener('click', ev => {
      const b = ev.target.closest('button[data-source]');
      if (!b) return;
      if (typeof S !== 'undefined' && S.mode !== 'report') return;
      switchReportSource(b.dataset.source);
    });
  }
}

(async function initReport() {
  try { await loadReportData(); }
  catch (e) {
    console.warn('report data', e);
    REPORT.ready = false;
    REPORT.error = String(e && e.message || e);
  }
  wireReport();
  const app = document.getElementById('app');
  if (typeof S !== 'undefined' && S.mode === 'report' && app && !app.classList.contains('hidden')) {
    renderReport();
  }
})();
