import { useEffect } from 'react';

// Tables inside these wrappers are restyled on phones as stacked cards (index.css); each cell then shows its
// column name, taken from the table's header.
const WRAPPERS = '.tl-stb-wrap, .tl-oev-table-wrap, .tl-dash-table-wrap, .tl-ml-scroll, .tl-gv-report section';

function labelTables() {
  for (const table of document.querySelectorAll(`:is(${WRAPPERS}) table`)) {
    const heads = [...table.querySelectorAll('thead tr:last-child th')].map((th) => th.textContent.trim());
    if (!heads.length) continue;
    for (const row of table.querySelectorAll('tbody tr')) {
      let col = 0;
      for (const cell of row.children) {
        const span = Number(cell.getAttribute('colspan') || 1);
        const label = span > 1 ? '' : heads[col] || '';
        if (cell.dataset.label !== label) cell.dataset.label = label;
        col += span;
      }
    }
  }
}

/** Keeps data-label on table cells up to date as pages render and change. Renders nothing. */
export default function TableLabels() {
  useEffect(() => {
    let frame = 0;
    const schedule = () => {
      if (frame) return;
      frame = requestAnimationFrame(() => {
        frame = 0;
        labelTables();
      });
    };
    schedule();
    const observer = new MutationObserver(schedule);
    observer.observe(document.body, { childList: true, subtree: true });
    return () => {
      observer.disconnect();
      cancelAnimationFrame(frame);
    };
  }, []);
  return null;
}
