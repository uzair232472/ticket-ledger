#!/usr/bin/env node
/**
 * Builds docs/codebase-guide/index.html — a single, offline, self-contained reading version of the
 * Markdown handbook (sidebar, search, collapsible sections, rendered Mermaid diagrams).
 *
 * Usage (from the repository root):
 *   TL_DOCS_TOOLS=/path/to/folder/with/node_modules node docs/codebase-guide/_build/build-html.mjs
 * The tools folder must contain `marked` (v12) and `mermaid` (v10, for dist/mermaid.min.js), e.g.:
 *   mkdir /tmp/tl-docs && cd /tmp/tl-docs && npm init -y && npm i marked@12 mermaid@10.9.1
 * The script also validates every internal link and #anchor and exits with code 1 if any is broken.
 */
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const GUIDE = path.resolve(HERE, '..');
const TOOLS = process.env.TL_DOCS_TOOLS;
if (!TOOLS) {
  console.error('Set TL_DOCS_TOOLS to a folder whose node_modules contains marked@12 and mermaid@10.');
  process.exit(2);
}
const req = createRequire(path.join(TOOLS, 'node_modules', 'x.js'));
const { marked } = req('marked');
const mermaidJs = fs.readFileSync(req.resolve('mermaid/dist/mermaid.min.js'), 'utf8');

// Reading order of the pages (also the sidebar order)
const PAGES = [
  'README.md',
  '01-architecture.md',
  '02-modules/README.md',
  '02-modules/authentication.md',
  '02-modules/companies-staff.md',
  '02-modules/events.md',
  '02-modules/venues-seating.md',
  '02-modules/seat-locking-holds.md',
  '02-modules/booking-payment.md',
  '02-modules/tickets-qr.md',
  '02-modules/gate-checkin.md',
  '02-modules/transfers-resale.md',
  '02-modules/blockchain-nft.md',
  '02-modules/behavior-analytics-ml.md',
  '02-modules/notifications-email.md',
  '02-modules/dashboards-admin.md',
  '02-modules/frontend-shell.md',
  '03-journeys.md',
  '04-file-inventory.md',
  'functions/README.md',
  'functions/api-core.md',
  'functions/api-auth-accounts.md',
  'functions/api-notifications-email.md',
  'functions/api-companies-staff.md',
  'functions/api-events.md',
  'functions/api-venues-seats.md',
  'functions/api-booking-payment.md',
  'functions/api-tickets-qr-gate.md',
  'functions/api-resale-transfer-nft.md',
  'functions/api-analytics-ml.md',
  'functions/ml-service.md',
  'functions/scripts-tests-infra.md',
  'functions/web-core.md',
  'functions/web-components.md',
  'functions/web-pages.md',
  '06-api-catalogue.md',
  '07-database.md',
  '08-shared-code.md',
  '09-state-realtime-config.md',
  '10-change-index.md',
  '11-glossary.md',
  '12-coverage.md',
];
const GROUPS = [
  ['Start', ['README.md', '01-architecture.md']],
  ['Modules', PAGES.filter((p) => p.startsWith('02-modules/'))],
  ['Journeys & files', ['03-journeys.md', '04-file-inventory.md']],
  ['Function catalogue', PAGES.filter((p) => p.startsWith('functions/'))],
  ['Reference', ['06-api-catalogue.md', '07-database.md', '08-shared-code.md', '09-state-realtime-config.md', '10-change-index.md', '11-glossary.md', '12-coverage.md']],
];

const pageId = (p) => 'p-' + p.replace(/\.md$/, '').replace(/[^a-z0-9]+/gi, '-').toLowerCase();
// GitHub-compatible heading slug
const slug = (text) =>
  text
    .toLowerCase()
    .replace(/<[^>]+>/g, '')
    .replace(/[^\p{L}\p{N}\s_-]/gu, '')
    .trim()
    .replace(/\s/g, '-');
const escapeHtml = (s) => s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const plain = (html) => html.replace(/<[^>]+>/g, '').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;/g, "'");

const ids = new Set();
const links = []; // {from, href, target}
const fileLinksMissing = [];
const pagesOut = [];
const searchIndex = [];

for (const page of PAGES) {
  const file = path.join(GUIDE, page);
  const md = fs.readFileSync(file, 'utf8');
  const pid = pageId(page);
  ids.add(pid);
  const seen = {};
  const toc = [];
  let title = page;
  const renderer = new marked.Renderer();
  renderer.heading = (text, level, raw) => {
    let s = slug(raw);
    if (seen[s] !== undefined) {
      seen[s] += 1;
      s = `${s}-${seen[s]}`;
    } else seen[s] = 0;
    const id = `${pid}--${s}`;
    ids.add(id);
    if (level === 1) title = plain(text);
    if (level === 2 || level === 3) toc.push({ level, id, text: plain(text) });
    return `<h${level} id="${id}" data-level="${level}"><a class="hl" href="#${id}" aria-label="Link to this section">#</a>${text}</h${level}>\n`;
  };
  renderer.code = (code, lang) => {
    if (lang === 'mermaid') return `<div class="diagram"><pre class="mermaid">${escapeHtml(code)}</pre></div>\n`;
    return `<pre><code class="lang-${lang || 'text'}">${escapeHtml(code)}</code></pre>\n`;
  };
  renderer.link = (href, titleAttr, text) => {
    let out = href;
    if (!/^(https?:|mailto:)/.test(href)) {
      const [p, hash] = href.split('#');
      if (!p) out = `#${pid}--${hash}`;
      else if (p.endsWith('.md') && PAGES.includes(path.posix.normalize(path.posix.join(path.posix.dirname(page), p)))) {
        const target = path.posix.normalize(path.posix.join(path.posix.dirname(page), p));
        out = hash ? `#${pageId(target)}--${hash}` : `#${pageId(target)}`;
      } else {
        const f = path.posix.normalize(path.posix.join(path.posix.dirname(page), p));
        if (!fs.existsSync(path.join(GUIDE, f))) fileLinksMissing.push(`${page}: ${href}`);
        // non-Markdown file inside the guide (e.g. index.html, _build/README.md): keep as relative file link
        out = path.posix.normalize(path.posix.join(path.posix.dirname(page), p));
      }
      if (out.startsWith('#')) links.push({ from: page, href, target: out.slice(1) });
    }
    return `<a href="${out}"${/^https?:/.test(out) ? ' target="_blank" rel="noopener"' : ''}>${text}</a>`;
  };
  let html = marked.parse(md, { renderer, gfm: true, mangle: false, headerIds: false });
  // explicit anchors written as <a id="..."></a> in the Markdown
  html = html.replace(/<a id="([^"]+)"><\/a>/g, (_, a) => {
    const id = `${pid}--${a}`;
    ids.add(id);
    return `<a id="${id}" class="anchor"></a>`;
  });
  // search entries: sections (h2/h3) and table rows
  const sections = html.split(/(?=<h[23] id=")/);
  for (const sec of sections) {
    const m = sec.match(/^<h([23]) id="([^"]+)"[^>]*>(.*?)<\/h\1>/s);
    const id = m ? m[2] : pid;
    const head = m ? plain(m[3]).replace(/^#/, '') : title;
    const body = plain(sec.replace(/<pre class="mermaid">[\s\S]*?<\/pre>/g, '')).replace(/\s+/g, ' ');
    searchIndex.push({ p: title, h: head, id, t: body.slice(0, 6000) });
  }
  pagesOut.push({ page, pid, title, html, toc });
}

// Validate internal links
const broken = links.filter((l) => !ids.has(l.target));
if (fileLinksMissing.length) { console.error('Missing linked files:'); fileLinksMissing.forEach((x) => console.error('  ' + x)); }
if (broken.length) {
  console.error(`Broken internal links: ${broken.length}`);
  for (const b of broken) console.error(`  ${b.from}: ${b.href} -> #${b.target}`);
}

const nav = GROUPS.map(([g, list]) => {
  const items = list
    .map((p) => {
      const po = pagesOut.find((x) => x.page === p);
      const sub = po.toc.filter((t) => t.level === 2).map((t) => `<li><a href="#${t.id}">${escapeHtml(t.text)}</a></li>`).join('');
      return `<li class="navpage"><a class="navtitle" href="#${po.pid}" data-page="${po.pid}">${escapeHtml(po.title)}</a>${sub ? `<ul class="navsub">${sub}</ul>` : ''}</li>`;
    })
    .join('');
  return `<div class="navgroup"><h2>${g}</h2><ul>${items}</ul></div>`;
}).join('');

const content = pagesOut
  .map((p) => `<section class="page" id="${p.pid}" data-src="${p.page}">${p.html}<p class="pagefoot">Source: <code>docs/codebase-guide/${p.page}</code></p></section>`)
  .join('\n');

const css = `
:root{--bg:#fbfbf9;--panel:#ffffff;--ink:#17201b;--muted:#5b665f;--line:#dfe4de;--accent:#167a3e;--accent-soft:#e7f3ea;--code:#f2f4f1;--warn:#a15c00;--mark:#fff2a8}
@media (prefers-color-scheme: dark){:root:not([data-theme="light"]){--bg:#111513;--panel:#171c19;--ink:#e4ebe6;--muted:#9aa79f;--line:#2b332e;--accent:#4cc47a;--accent-soft:#1d2a22;--code:#1e2421;--warn:#f0b35a;--mark:#5a4d00}}
:root[data-theme="dark"]{--bg:#111513;--panel:#171c19;--ink:#e4ebe6;--muted:#9aa79f;--line:#2b332e;--accent:#4cc47a;--accent-soft:#1d2a22;--code:#1e2421;--warn:#f0b35a;--mark:#5a4d00}
*{box-sizing:border-box}html{scroll-padding-top:70px}
body{margin:0;background:var(--bg);color:var(--ink);font:15px/1.6 system-ui,-apple-system,"Segoe UI",Roboto,sans-serif}
header.top{position:sticky;top:0;z-index:20;display:flex;gap:12px;align-items:center;padding:10px 16px;background:var(--panel);border-bottom:1px solid var(--line)}
header.top .brand{font-weight:700;white-space:nowrap}header.top .brand span{color:var(--accent)}
#q{flex:1;min-width:0;max-width:560px;padding:8px 12px;border:1px solid var(--line);border-radius:8px;background:var(--bg);color:var(--ink);font:inherit}
button.tb{border:1px solid var(--line);background:var(--bg);color:var(--ink);border-radius:8px;padding:7px 10px;font:inherit;cursor:pointer;white-space:nowrap}
#menu{display:none}
.layout{display:grid;grid-template-columns:300px minmax(0,1fr)}
nav.side{position:sticky;top:57px;height:calc(100vh - 57px);overflow:auto;padding:12px 10px 40px;border-right:1px solid var(--line);background:var(--panel)}
nav.side h2{font-size:11px;text-transform:uppercase;letter-spacing:.08em;color:var(--muted);margin:16px 8px 6px}
nav.side ul{list-style:none;margin:0;padding:0}nav.side a{color:var(--ink);text-decoration:none;display:block;padding:3px 8px;border-radius:6px}
nav.side a:hover{background:var(--accent-soft)}nav.side .navtitle{font-weight:600}nav.side .navsub{display:none;margin:2px 0 6px 10px;border-left:2px solid var(--line)}
nav.side .navsub a{font-size:13px;color:var(--muted)}nav.side .navpage.open .navsub{display:block}nav.side .active>.navtitle{background:var(--accent-soft);color:var(--accent)}
main{min-width:0;padding:16px 32px 80px}
.page{max-width:1100px;margin:0 auto 48px;padding-bottom:24px;border-bottom:3px double var(--line)}
h1{font-size:30px;line-height:1.25;margin:28px 0 12px}h2{font-size:22px;margin:30px 0 10px;padding-top:6px;border-top:1px solid var(--line)}h3{font-size:18px;margin:22px 0 8px}h4{font-size:16px}
h2,h3{cursor:pointer;position:relative}h2::before,h3::before{content:"▾";position:absolute;left:-18px;color:var(--muted);font-size:14px;top:.35em}
.collapsed::before{content:"▸"!important}
.hl{opacity:0;margin-right:6px;color:var(--muted);text-decoration:none}h1:hover .hl,h2:hover .hl,h3:hover .hl,h4:hover .hl{opacity:1}
a{color:var(--accent)}code{background:var(--code);padding:1px 5px;border-radius:4px;font:13px/1.45 ui-monospace,SFMono-Regular,Consolas,monospace;word-break:break-word}
pre{background:var(--code);padding:12px 14px;border-radius:8px;overflow:auto}pre code{background:none;padding:0;word-break:normal}
table{border-collapse:collapse;width:100%;margin:10px 0 18px;font-size:14px;display:block;overflow-x:auto}
th,td{border:1px solid var(--line);padding:6px 9px;vertical-align:top;text-align:left}th{background:var(--accent-soft)}
tr.hit td{background:var(--mark)}
blockquote{margin:12px 0;padding:8px 14px;border-left:4px solid var(--accent);background:var(--accent-soft);border-radius:0 8px 8px 0}
.diagram{background:var(--panel);border:1px solid var(--line);border-radius:10px;padding:12px;overflow:auto;margin:12px 0}
.diagram pre.mermaid{background:none;margin:0;text-align:center}
.pagefoot{color:var(--muted);font-size:12px}
.hidden{display:none!important}
#results{position:fixed;top:57px;right:16px;left:316px;max-height:70vh;overflow:auto;background:var(--panel);border:1px solid var(--line);border-radius:10px;box-shadow:0 12px 40px rgba(0,0,0,.18);z-index:30;padding:8px}
#results a{display:block;padding:8px 10px;border-radius:8px;color:var(--ink);text-decoration:none}#results a:hover,#results a.sel{background:var(--accent-soft)}
#results .rp{font-size:12px;color:var(--muted)}#results .rs{font-size:13px;color:var(--muted)}#results mark{background:var(--mark);color:inherit}
@media (max-width:900px){.layout{grid-template-columns:1fr}nav.side{position:fixed;left:0;top:57px;width:85vw;max-width:320px;z-index:25;transform:translateX(-100%);transition:transform .2s}
body.navopen nav.side{transform:none}#menu{display:inline-block}main{padding:12px 16px 60px}#results{left:16px}h2::before,h3::before{display:none}header.top .brand{display:none}}
`;

const js = `
const idx = ${JSON.stringify(searchIndex)};
const $ = (s) => document.querySelector(s);
const q = $('#q'), results = $('#results');
const esc = (s) => s.replace(/[&<>]/g, (c) => ({'&':'&amp;','<':'&lt;','>':'&gt;'}[c]));
function search(term){
  term = term.trim().toLowerCase();
  if (term.length < 2){ results.classList.add('hidden'); clearRowHits(); return; }
  const words = term.split(/\\s+/);
  const scored = [];
  for (const e of idx){
    const h = e.h.toLowerCase(), t = e.t.toLowerCase();
    if (!words.every((w) => h.includes(w) || t.includes(w))) continue;
    let s = 0; for (const w of words){ if (h.includes(w)) s += 10; s += Math.min(5, t.split(w).length - 1); }
    scored.push([s, e]);
  }
  scored.sort((a,b) => b[0]-a[0]);
  results.innerHTML = scored.slice(0, 60).map(([,e]) => {
    const t = e.t, i = t.toLowerCase().indexOf(words[0]);
    const snip = i >= 0 ? t.slice(Math.max(0, i-60), i+120) : t.slice(0,160);
    const mk = esc(snip).replace(new RegExp(words.map((w)=>w.replace(/[.*+?^\${}()|[\\]\\\\]/g,'\\\\$&')).join('|'),'gi'), (m)=>'<mark>'+m+'</mark>');
    return '<a href="#'+e.id+'"><div class="rp">'+esc(e.p)+'</div><div>'+esc(e.h)+'</div><div class="rs">…'+mk+'…</div></a>';
  }).join('') || '<div style="padding:10px">No matches.</div>';
  results.classList.remove('hidden');
  markRows(words);
}
function clearRowHits(){ document.querySelectorAll('tr.hit').forEach((r)=>r.classList.remove('hit')); }
function markRows(words){ clearRowHits(); document.querySelectorAll('td').forEach(()=>{}); document.querySelectorAll('tbody tr').forEach((r)=>{ const t=r.textContent.toLowerCase(); if(words.every((w)=>t.includes(w))) r.classList.add('hit'); }); }
let timer; q.addEventListener('input', () => { clearTimeout(timer); timer = setTimeout(() => search(q.value), 120); });
q.addEventListener('keydown', (e) => { if (e.key === 'Escape'){ q.value=''; search(''); } if (e.key === 'Enter'){ const a = results.querySelector('a'); if (a){ location.hash = a.getAttribute('href'); results.classList.add('hidden'); } } });
results.addEventListener('click', (e) => { if (e.target.closest('a')) results.classList.add('hidden'); });
document.addEventListener('keydown', (e) => { if (e.key === '/' && document.activeElement !== q){ e.preventDefault(); q.focus(); } });
// collapsible h2/h3 sections
function sectionNodes(h){ const lvl = +h.dataset.level; const out = []; let n = h.nextElementSibling; while (n && !(/^H[1-6]$/.test(n.tagName) && +n.tagName[1] <= lvl) && !n.classList.contains('pagefoot')){ out.push(n); n = n.nextElementSibling; } return out; }
function setCollapsed(h, c){ h.classList.toggle('collapsed', c); sectionNodes(h).forEach((n)=>{ n.classList.toggle('hidden', c); if(!c && /^H[23]$/.test(n.tagName) && n.classList.contains('collapsed')) {/* keep nested state */} }); if(!c){ sectionNodes(h).filter((n)=>/^H[23]$/.test(n.tagName) && n.classList.contains('collapsed')).forEach((n)=>sectionNodes(n).forEach((x)=>x.classList.add('hidden'))); } }
document.querySelectorAll('h2[data-level],h3[data-level]').forEach((h) => h.addEventListener('click', (e) => { if (e.target.closest('a')) return; setCollapsed(h, !h.classList.contains('collapsed')); }));
$('#expand').addEventListener('click', () => document.querySelectorAll('h2.collapsed,h3.collapsed').forEach((h)=>setCollapsed(h,false)));
$('#collapse').addEventListener('click', () => document.querySelectorAll('.page h3[data-level]').forEach((h)=>setCollapsed(h,true)));
// reveal target when navigating into a collapsed area
function reveal(id){ const el = document.getElementById(id); if (!el) return; let n = el; while (n && !n.classList?.contains('page')){ if (n.classList?.contains('hidden')) { let p = n.previousElementSibling; while (p && !(p.matches && p.matches('h2.collapsed,h3.collapsed'))) p = p.previousElementSibling; if (p) setCollapsed(p,false); else n.classList.remove('hidden'); } n = n.parentElement || n.previousElementSibling; if (n === el) break; }
  let p = el; while (p && p.classList && p.classList.contains('hidden')) { p.classList.remove('hidden'); }
  document.querySelectorAll('.page .hidden').forEach(()=>{}); }
window.addEventListener('hashchange', () => { reveal(location.hash.slice(1)); document.body.classList.remove('navopen'); highlightNav(); });
// sidebar state
const navLinks = [...document.querySelectorAll('.navtitle')];
function highlightNav(){ const pages=[...document.querySelectorAll('.page')]; let cur=pages[0]; for(const p of pages){ if(p.getBoundingClientRect().top < 120) cur=p; } navLinks.forEach((a)=>{ const li=a.parentElement; const on=a.dataset.page===cur.id; li.classList.toggle('active',on); li.classList.toggle('open',on); }); }
let st; document.addEventListener('scroll', () => { clearTimeout(st); st = setTimeout(highlightNav, 80); }, {passive:true});
$('#menu').addEventListener('click', () => document.body.classList.toggle('navopen'));
$('#theme').addEventListener('click', () => { const r=document.documentElement; const dark = r.dataset.theme ? r.dataset.theme==='dark' : matchMedia('(prefers-color-scheme: dark)').matches; r.dataset.theme = dark ? 'light' : 'dark'; try{localStorage.setItem('tl-guide-theme', r.dataset.theme);}catch(e){} renderDiagrams(true); });
try{ const t=localStorage.getItem('tl-guide-theme'); if(t) document.documentElement.dataset.theme=t; }catch(e){}
// Mermaid
const sources = [...document.querySelectorAll('pre.mermaid')].map((el)=>el.textContent);
async function renderDiagrams(again){
  const r=document.documentElement; const dark = r.dataset.theme ? r.dataset.theme==='dark' : matchMedia('(prefers-color-scheme: dark)').matches;
  mermaid.initialize({ startOnLoad:false, securityLevel:'strict', theme: dark ? 'dark' : 'default', flowchart:{ htmlLabels:true, useMaxWidth:true }, er:{ useMaxWidth:true } });
  const els=[...document.querySelectorAll('pre.mermaid')];
  els.forEach((el,i)=>{ if(again){ el.removeAttribute('data-processed'); el.textContent = sources[i]; } });
  try { await mermaid.run({ nodes: els }); } catch(e){ console.warn('Mermaid render issue', e); }
}
renderDiagrams(false).then(() => { if (location.hash) { reveal(location.hash.slice(1)); document.getElementById(location.hash.slice(1))?.scrollIntoView(); } highlightNav(); });
`;

const html = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>TicketLedger Codebase Handbook</title>
<meta name="description" content="Offline reading version of the TicketLedger codebase handbook (generated from docs/codebase-guide/*.md).">
<style>${css}</style>
</head>
<body>
<header class="top">
  <button class="tb" id="menu" aria-label="Open navigation">☰</button>
  <div class="brand">Ticket<span>Ledger</span> handbook</div>
  <input id="q" type="search" placeholder="Search files, functions, endpoints, tables…  (press /)" aria-label="Search the handbook">
  <button class="tb" id="expand" title="Expand all sections">Expand all</button>
  <button class="tb" id="collapse" title="Collapse level-3 sections">Collapse</button>
  <button class="tb" id="theme" title="Toggle light/dark">◐</button>
</header>
<div id="results" class="hidden" role="listbox"></div>
<div class="layout">
<nav class="side" aria-label="Handbook sections">${nav}</nav>
<main>${content}</main>
</div>
<script>${mermaidJs}</script>
<script>${js}</script>
</body>
</html>`;

fs.writeFileSync(path.join(GUIDE, 'index.html'), html);
console.log(`index.html written: ${(html.length / 1024 / 1024).toFixed(2)} MB, ${PAGES.length} pages, ${ids.size} anchors, ${links.length} internal links, ${broken.length} broken.`);
process.exit(broken.length || fileLinksMissing.length ? 1 : 0);
