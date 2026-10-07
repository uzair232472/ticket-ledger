# Rebuilding `index.html`

[← Start here](../README.md)

`index.html` is generated from the Markdown pages of this handbook. Edit the Markdown, then rebuild; never edit `index.html` by hand.

## What the build does

`build-html.mjs`:
1. Reads the pages in the reading order listed in its `PAGES` array (this order is also the sidebar order; `GROUPS` sets the sidebar headings).
2. Converts each page with `marked`, giving every heading an id `<page>--<github-style slug>` and rewriting links between pages to in-document anchors.
3. Turns ```` ```mermaid ```` blocks into diagrams by inlining `mermaid.min.js`. The output works offline and needs no server or CDN.
4. Builds the search index (headings, sections and table rows) and adds collapsible sections, expand/collapse-all buttons and a light/dark toggle.
5. **Checks every internal link, `#anchor` and linked file.** If anything is broken it prints the list and exits with code 1, without writing a partial file.

## One-time setup

The repository does not depend on `marked` or `mermaid`, so install them in a separate folder outside the repo:

```bash
mkdir -p /tmp/tl-docs && cd /tmp/tl-docs
npm init -y
npm i marked@12 mermaid@10.9.1
```

## Build

From the repository root:

```bash
TL_DOCS_TOOLS=/tmp/tl-docs node docs/codebase-guide/_build/build-html.mjs
```

PowerShell:

```powershell
$env:TL_DOCS_TOOLS = "$env:TEMP\tl-docs"; node docs/codebase-guide/_build/build-html.mjs
```

A successful run prints the page count, the number of links checked, and `0 broken`.

## Adding a page

1. Create the Markdown file under `docs/codebase-guide/`.
2. Add its path to `PAGES` (and to a group in `GROUPS`) in `build-html.mjs`.
3. Link it from [`README.md`](../README.md) so Markdown readers can find it too.
4. Rebuild and fix any broken links the script reports.

A link to a `.md` file that is not in `PAGES` (like this page) is treated as a plain file link: the build checks that the file exists but does not include it in `index.html`.
