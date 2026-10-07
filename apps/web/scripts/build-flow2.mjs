#!/usr/bin/env node
/**
 * Builds flow2.html (repository root): a self-contained workflow explorer with the corrected flows of every
 * module (src/components/workflow/flow2Data.js), using the same engine and styles as the in-app /workflow page.
 *
 *   node apps/web/scripts/build-flow2.mjs
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const web = path.resolve(here, '..');
const repo = path.resolve(web, '..', '..');
const read = (p) => fs.readFileSync(path.join(web, p), 'utf8');
const stripExport = (src) => src.replace(/^export function /m, 'function ');

const engine = stripExport(read('src/components/workflow/workflowEngine.js'));
const dataSrc = stripExport(read('src/components/workflow/flow2Data.js'));
const css = read('src/components/workflow/workflow.css');
const mark = read('src/assets/ticketledger-mark.svg').replace('<svg ', '<svg class="f2-mark" aria-hidden="true" ');

const html = `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <meta name="description" content="TicketLedger workflows as implemented: the overall flow through every module and each module's animated flowchart.">
  <title>TicketLedger | Workflows (as implemented)</title>
  <link rel="preconnect" href="https://fonts.googleapis.com">
  <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
  <link href="https://fonts.googleapis.com/css2?family=JetBrains+Mono:wght@500;600;700&family=Plus+Jakarta+Sans:wght@400;500;600;700;800&display=swap" rel="stylesheet">
  <style>
    /* Home page tokens (apps/web/src/components/home/home.css) */
    *{box-sizing:border-box}html,body{margin:0;height:100%;overflow:hidden}
    body{font-family:'Plus Jakarta Sans',system-ui,sans-serif;-webkit-font-smoothing:antialiased}
    .tl-home{--tl-green:#22c55e;--tl-green-dark:#15803d;--tl-ink:#052e16;--tl-night:#07110b;--tl-header-h:76px;position:relative;background:var(--tl-night);color:#fff}
    .tl-eyebrow{margin:0;font:600 12px/1.2 'JetBrains Mono',monospace;letter-spacing:.12em;text-transform:uppercase;color:#86efac}
    .f2-header{position:fixed;inset:0 0 auto;z-index:60;height:var(--tl-header-h);display:flex;align-items:center;justify-content:space-between;padding:0 clamp(16px,2.4vw,32px)}
    .f2-brand{display:inline-flex;align-items:center;gap:10px;padding:0;border:0;background:none;color:#fff;font:800 26px/1 'Plus Jakarta Sans',sans-serif;letter-spacing:-.04em;cursor:pointer}
    .f2-brand b{font-weight:inherit;color:var(--tl-green)}
    .f2-mark{width:40px;height:auto}.f2-mark path[fill="#051a3d"]{fill:#fff}
    .f2-tag{font:600 11px/1 'JetBrains Mono',monospace;letter-spacing:.12em;text-transform:uppercase;color:#86efac;border:1px solid rgba(134,239,172,.35);border-radius:999px;padding:6px 10px}
    @media (max-width:479px){.f2-brand{font-size:20px}.f2-mark{width:30px}.f2-tag{display:none}}
  </style>
  <style>
${css}
  </style>
</head>
<body>
  <div class="tl-home tl-wf">
    <header class="f2-header">
      <button class="f2-brand" type="button" data-fc="home" aria-label="TicketLedger — open overall flow">${mark}<span>Ticket<b>Ledger</b></span></button>
      <span class="f2-tag">As implemented · 323a885</span>
    </header>
    <main class="wf-app" id="wf" aria-label="TicketLedger workflow explorer">
      <div class="wf-heading">
        <div class="wf-heading-copy">
          <p class="tl-eyebrow wf-eyebrow"><span>Workflow explorer</span><span class="wf-count" data-count></span></p>
          <div class="wf-title-row"><h1 class="wf-title" data-fc="title" tabindex="-1">Overall flow</h1><span class="wf-status-pill" data-fc="status" hidden></span></div>
          <p class="wf-basis" data-fc="basis"></p>
        </div>
        <label class="wf-picker"><span>Module / workflow</span><select data-fc="select" aria-label="Choose a module or workflow"></select></label>
      </div>
      <div class="wf-nav">
        <div class="wf-path"><button class="wf-btn wf-back" data-fc="back" type="button" aria-label="Back to previous flow">← <span>Back</span></button><nav class="wf-crumbs" data-fc="crumbs" aria-label="Workflow path"></nav></div>
        <div class="wf-controls"><button class="wf-btn wf-btn--green" data-fc="play" type="button">Pause</button><button class="wf-btn" data-fc="step" type="button">Next step →</button></div>
      </div>
      <section class="wf-stage" aria-label="Interactive flowchart canvas">
        <svg class="wf-canvas" data-fc="svg" role="img" aria-label="Workflow diagram" preserveAspectRatio="xMidYMid meet"></svg>
        <p class="wf-hint">Click a module to open its flow · Drag to pan · Pinch or scroll to zoom</p>
        <div class="wf-zoom" aria-label="Diagram zoom controls"><button data-fc="zoom-out" type="button" aria-label="Zoom out">−</button><output data-fc="zoom-level" aria-live="off">100%</output><button data-fc="zoom-in" type="button" aria-label="Zoom in">+</button><button data-fc="fit" type="button" title="Fit the entire flow to the screen">Fit</button></div>
      </section>
      <footer class="wf-status">
        <div><div class="wf-status-line"><span class="wf-position" data-fc="position"></span><span class="wf-current" data-fc="current"></span></div><p class="wf-detail" data-fc="detail"></p></div>
        <div class="wf-legend"><span><i class="wf-dot"></i>Current step</span><span data-fc="branch-legend">┄ Related / optional</span><span><i class="wf-progress-dot"></i>In progress</span><span>↗ Open module</span></div>
      </footer>
      <span class="wf-sr" data-fc="live" aria-live="polite"></span>
    </main>
  </div>
  <script>
${engine}
${dataSrc}
(function () {
  var data = buildWorkflowData();
  document.querySelector('[data-count]').textContent = data.moduleCount + ' modules';
  // Mounted on the whole page so the header brand (data-fc="home") also returns to the overall flow
  mountWorkflow(document.body, data);
})();
  </script>
</body>
</html>
`;
fs.writeFileSync(path.join(repo, 'flow2.html'), html);
console.log('flow2.html written:', (html.length / 1024).toFixed(1), 'KB');
