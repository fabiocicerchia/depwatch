// The report, as a page: the same layout the depwatch page in docs/ uses — a
// heading, the stats, the quadrant chart, then the table the CLI prints.
//
// It renders twice over, same structure and two palettes. Into a webview, where
// every colour and font is the editor's own theme token, so the report is VS
// Code's UI rather than a look of its own; and into a standalone file for
// export, where there is no theme to inherit, no script, and the docs/ palette
// is what a browser gets.

import type { GateFailure, QuadrantCounts } from '../../../src/gates.js'
import { escapeXml as esc, QUADRANT_COLOR } from '../../../src/quadrant.js'
import type { DepReport, Quadrant, Report, Thresholds } from '../../../src/report.js'
import type { TrendPoint } from '../../../src/trend.js'
import { ORDER, QUADRANT, reasons } from './explain.js'

// The editor publishes its theme's chart colours to webviews; the depwatch
// palette is the fallback, which is what the exported file gets.
const QUADRANT_CSS: Record<Quadrant, string> = {
  replace: `var(--vscode-charts-red,${QUADRANT_COLOR.replace})`,
  upgrade: `var(--vscode-charts-yellow,${QUADRANT_COLOR.upgrade})`,
  watch: `var(--vscode-charts-blue,${QUADRANT_COLOR.watch})`,
  healthy: `var(--vscode-charts-green,${QUADRANT_COLOR.healthy})`,
}

export interface ManifestView {
  /** Workspace-relative path, for display. */
  label: string
  /** Absolute path, for the click-to-reveal message. */
  path: string
  report: Report
  svg: string
  notes: string[]
  counts: QuadrantCounts
}

export interface ReportView {
  manifests: ManifestView[]
  failures: { label: string; message: string }[]
  gates: GateFailure[]
  gatesConfigured: boolean
  thresholds: Thresholds
  deep: boolean
  generatedAt: string
}

export interface PageOptions {
  /** Set for a webview: enables the CSP meta tag and the click-to-reveal script. */
  nonce?: string
  cspSource?: string
}

export function reportHtml(view: ReportView, opts: PageOptions = {}): string {
  const totals = view.manifests.reduce(
    (acc, m) => {
      acc.libyears += m.report.totalLibyears
      acc.deps += m.report.deps.length
      for (const q of ORDER) acc.counts[q] += m.counts[q]
      return acc
    },
    { libyears: 0, deps: 0, counts: { healthy: 0, upgrade: 0, watch: 0, replace: 0 } as QuadrantCounts },
  )

  const body: string[] = []
  body.push(`<h1>📉 depwatch</h1>`)
  body.push(`<p class="tagline">Dependency drift (libyears) × viability, plotted as a quadrant.</p>`)

  if (view.manifests.length === 0 && view.failures.length === 0) {
    body.push(
      `<p class="desc">Nothing scanned yet. Run <code>depwatch: Scan the workspace</code> from the command palette.</p>`,
    )
    return page('depwatch report', body.join(''), opts)
  }

  body.push(`<div class="stats">
    ${stat(totals.libyears.toFixed(2), 'libyears of drift')}
    ${stat(String(totals.deps), totals.deps === 1 ? 'dependency' : 'dependencies')}
    ${stat(String(view.manifests.length), view.manifests.length === 1 ? 'manifest' : 'manifests')}
    ${quadStat(totals.counts)}
  </div>`)

  body.push(gateBanner(view))

  for (const m of view.manifests) body.push(manifestSection(m, view))

  if (view.failures.length > 0) {
    body.push(`<h2>Not scanned</h2><ul class="failures">`)
    for (const f of view.failures) body.push(`<li><code>${esc(f.label)}</code> — ${esc(f.message)}</li>`)
    body.push(`</ul>`)
  }

  body.push(footer(view))
  return page('depwatch report', body.join(''), opts)
}

function manifestSection(m: ManifestView, view: ReportView): string {
  const out: string[] = []
  out.push(`<h2>${esc(m.label)}</h2>`)
  out.push(
    `<p class="desc">${esc(m.report.totalLibyears.toFixed(2))} libyears across ${m.report.deps.length} deps · ${esc(m.report.ecosystem)} · ${esc(m.report.file)}</p>`,
  )
  for (const note of m.notes) out.push(`<p class="alt">${esc(note)}</p>`)
  out.push(`<div class="chart">${m.svg}</div>`)
  out.push(table(m, view))

  const degraded = m.report.deps.filter((d) => d.degraded).length
  if (degraded > 0) out.push(`<p class="alt">${degraded} dep(s) had no registry data and were not scored.</p>`)
  const estimated = m.report.deps.filter((d) => !d.resolved && !d.degraded).length
  if (estimated > 0) {
    out.push(
      `<p class="alt">Upper bound: ${estimated} of ${m.report.deps.length} versions came from a range, not a lock file — a range gives its floor, so the real drift is this or lower.</p>`,
    )
  }
  return out.join('')
}

const RANK: Record<string, number> = { replace: 0, upgrade: 1, watch: 2, healthy: 3 }

function table(m: ManifestView, view: ReportView): string {
  const rows = [...m.report.deps].sort(
    (a, b) => RANK[a.quadrant] - RANK[b.quadrant] || b.libyearsBehind - a.libyearsBehind || a.name.localeCompare(b.name),
  )
  const head = ['dep', 'current', 'latest', 'drift', 'pulse', 'viability', 'quadrant']
    .map((h, i) => `<th data-col="${i}"${i >= 3 ? ' class="num"' : ''}>${h}</th>`)
    .join('')

  const cells = rows.map((d) => row(d, m, view)).join('')
  return `<table><thead><tr>${head}</tr></thead><tbody>${cells}</tbody></table>`
}

function row(d: DepReport, m: ManifestView, view: ReportView): string {
  const why = reasons(d)
    .map((r) => r.replace(/\*\*/g, ''))
    .join(' · ')
  const q = d.degraded ? 'no data' : QUADRANT[d.quadrant].label
  const colour = d.degraded ? 'var(--dim)' : QUADRANT_CSS[d.quadrant]
  const num = (v: string) => `<td class="num">${v}</td>`
  return (
    `<tr data-dep="${esc(d.name)}" data-file="${esc(m.path)}" data-sort-quadrant="${RANK[d.quadrant]}" title="${esc(why)}">` +
    `<td class="dep">${esc(d.name)}</td>` +
    `<td class="ver">${esc(d.current)}</td>` +
    `<td class="ver">${esc(d.latest ?? '—')}</td>` +
    num(d.degraded ? '—' : d.libyearsBehind.toFixed(2)) +
    num(d.pulseYears === null ? '—' : d.pulseYears.toFixed(2)) +
    num(d.degraded ? '—' : bar(d.viability, view.thresholds)) +
    `<td><span class="q" style="color:${colour}">${esc(q)}</span></td></tr>`
  )
}

// The viability number with the score drawn behind it: the table is where you
// compare deps to each other, and a bar does that faster than two decimals.
function bar(viability: number, t: Thresholds): string {
  const pct = Math.round(viability * 100)
  const colour = viability < t.riskyViability ? QUADRANT_CSS.replace : QUADRANT_CSS.healthy
  return `<span class="bar"><span class="fill" style="width:${pct}%;background:${colour}"></span><span class="val">${viability.toFixed(2)}</span></span>`
}

function stat(value: string, label: string): string {
  return `<div class="stat"><div class="value">${esc(value)}</div><div class="label">${esc(label)}</div></div>`
}

function quadStat(counts: QuadrantCounts): string {
  const dots = ORDER.map(
    (q) =>
      `<span class="dot" style="--c:${QUADRANT_CSS[q]}" title="${esc(QUADRANT[q].blurb)}">${counts[q]} ${esc(QUADRANT[q].label.toLowerCase())}</span>`,
  ).join('')
  return `<div class="stat wide"><div class="dots">${dots}</div><div class="label">quadrants</div></div>`
}

function gateBanner(view: ReportView): string {
  if (!view.gatesConfigured) return ''
  if (view.gates.length === 0) {
    return `<div class="gate pass">Gates pass — the same checks <code>depwatch check --ci</code> runs.</div>`
  }
  const items = view.gates.map((g) => `<li>${esc(g.message)}</li>`).join('')
  return `<div class="gate fail"><strong>${view.gates.length} gate(s) failing</strong><ul>${items}</ul></div>`
}

function footer(view: ReportView): string {
  const tier = view.deep
    ? 'deep scan: maintainers, funding, archived status and last commit'
    : 'default scan: release timeline only — run a deep scan for maintainers and archived status'
  return `<footer>
    Thresholds: behind &gt; ${view.thresholds.staleLibyears} libyears, fading &lt; ${view.thresholds.riskyViability} viability · ${esc(tier)}<br>
    Generated ${esc(view.generatedAt)} · libyear is Cox, Bouwers, van Eekelen &amp; Visser, ICSE 2015 · Apache 2.0
  </footer>`
}

// --- trend ---

export function trendHtml(file: string, points: TrendPoint[], opts: PageOptions = {}): string {
  const body: string[] = []
  body.push(`<h1>📉 depwatch</h1>`)
  body.push(`<p class="tagline">Drift over the history of ${esc(file)}.</p>`)

  if (points.length === 0) {
    body.push(`<p class="desc">No commits touched this file.</p>`)
    return page('depwatch trend', body.join(''), opts)
  }

  body.push(`<div class="chart">${trendSvg(points)}</div>`)
  const rows = points
    .map(
      (p) =>
        `<tr><td class="ver">${esc(p.date.slice(0, 10))}</td><td class="dep">${esc(p.commit)}</td>` +
        `<td class="num">${p.totalLibyears.toFixed(2)}</td><td class="num">${p.deps}</td><td class="num">${p.replace}</td></tr>`,
    )
    .join('')
  body.push(
    `<table><thead><tr><th>date</th><th>commit</th><th class="num">libyears</th><th class="num">deps</th><th class="num">replace</th></tr></thead><tbody>${rows}</tbody></table>`,
  )

  const first = points[0]
  const last = points[points.length - 1]
  if (points.length > 1) {
    const delta = last.totalLibyears - first.totalLibyears
    body.push(
      `<p class="desc">${delta >= 0 ? '+' : ''}${delta.toFixed(2)} libyears over ${points.length} sampled commits — ${delta > 0 ? 'drifting further behind' : 'catching up'}.</p>`,
    )
  }
  return page('depwatch trend', body.join(''), opts)
}

const TW = 760
const TH = 260
const TPAD = { l: 54, r: 20, t: 20, b: 40 }

/** Total drift over sampled commits. Deliberately the same palette as the quadrant. */
export function trendSvg(points: TrendPoint[]): string {
  const innerW = TW - TPAD.l - TPAD.r
  const innerH = TH - TPAD.t - TPAD.b
  const max = Math.max(1, ...points.map((p) => p.totalLibyears))
  const x = (i: number) => TPAD.l + (points.length < 2 ? innerW / 2 : (i / (points.length - 1)) * innerW)
  const y = (v: number) => TPAD.t + innerH - (v / max) * innerH

  const parts: string[] = [`<rect width="${TW}" height="${TH}" fill="#0f1319"/>`]
  for (let i = 0; i <= 4; i++) {
    const v = (max / 4) * i
    parts.push(`<line x1="${TPAD.l}" y1="${r2(y(v))}" x2="${TW - TPAD.r}" y2="${r2(y(v))}" stroke="#20252e"/>`)
    parts.push(
      `<text x="${TPAD.l - 8}" y="${r2(y(v) + 3.5)}" font-size="10" fill="#6b7585" text-anchor="end" font-family="ui-monospace, monospace">${v.toFixed(1)}</text>`,
    )
  }

  const line = points.map((p, i) => `${r2(x(i))},${r2(y(p.totalLibyears))}`).join(' ')
  parts.push(
    `<polyline points="${line}" fill="none" stroke="${QUADRANT_COLOR.watch}" stroke-width="2" stroke-linejoin="round"/>`,
  )
  points.forEach((p, i) => {
    const colour = p.replace > 0 ? QUADRANT_COLOR.replace : QUADRANT_COLOR.healthy
    parts.push(
      `<circle cx="${r2(x(i))}" cy="${r2(y(p.totalLibyears))}" r="3.5" fill="${colour}"><title>${esc(`${p.date.slice(0, 10)} ${p.commit}: ${p.totalLibyears.toFixed(2)} libyears, ${p.deps} deps, ${p.replace} replace`)}</title></circle>`,
    )
  })

  // Only the ends are labelled: a dozen dates along a 760px axis is a smudge.
  const ends = points.length > 1 ? [0, points.length - 1] : [0]
  for (const i of ends) {
    parts.push(
      `<text x="${r2(x(i))}" y="${TH - 14}" font-size="10" fill="#6b7585" text-anchor="${i === 0 ? 'start' : 'end'}" font-family="ui-monospace, monospace">${esc(points[i].date.slice(0, 10))}</text>`,
    )
  }
  parts.push(
    `<text x="16" y="${TPAD.t + innerH / 2}" font-size="10" fill="#aab3c2" text-anchor="middle" font-family="ui-monospace, monospace" transform="rotate(-90 16 ${TPAD.t + innerH / 2})">libyears</text>`,
  )
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${TW} ${TH}" width="${TW}" height="${TH}" role="img" aria-label="Total drift over sampled commits">${parts.join('')}</svg>`
}

const r2 = (n: number) => Math.round(n * 100) / 100

// --- the shell ---

function page(title: string, body: string, opts: PageOptions): string {
  // Inside the editor the page is themed by the editor: same layout, but every
  // colour and font comes from the running theme rather than from a palette of
  // our own. Exported, there is no theme to inherit, so the depwatch page
  // colours from docs/index.html are used instead.
  const native = Boolean(opts.nonce)
  const csp = opts.nonce
    ? `<meta http-equiv="Content-Security-Policy" content="default-src 'none'; img-src ${opts.cspSource ?? ''} data:; style-src 'unsafe-inline'; script-src 'nonce-${opts.nonce}';">`
    : ''
  const script = opts.nonce ? `<script nonce="${opts.nonce}">${CLICK_SCRIPT}</script>` : ''
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
${csp}
<title>${esc(title)}</title>
<style>${native ? NATIVE_PALETTE : DEPWATCH_PALETTE}${LAYOUT}</style>
</head>
<body>
<div class="card">${body}</div>
${script}
</body>
</html>`
}

// Every value here is a colour VS Code publishes to webviews, so the report is
// the editor's own light, dark and high-contrast themes rather than a look of
// its own. The fallbacks are the depwatch palette, for the one case where a
// theme leaves a token undefined.
const NATIVE_PALETTE = `
:root{
  --accent:var(--vscode-textLink-foreground,#5aa9e6);
  --accent2:var(--vscode-charts-green,#4ec9a4);
  --page:var(--vscode-editor-background,#0b0f1a);
  --fg:var(--vscode-foreground,#eef1f8);
  --muted:var(--vscode-foreground,#c7cde0);
  --desc:var(--vscode-descriptionForeground,#aab2c8);
  --dim:var(--vscode-descriptionForeground,#6b7591);
  --line:var(--vscode-panel-border,var(--vscode-widget-border,#2a3350));
  --panel:var(--vscode-editorWidget-background,#0d1220);
  --code:var(--vscode-textPreformat-foreground,#9be9a8);
  --hover:var(--vscode-list-hoverBackground,rgba(90,169,230,.08));
  --pass:var(--vscode-charts-green,#4ec9a4);
  --fail:var(--vscode-charts-red,#f2665e);
  --body-font:var(--vscode-font-family,-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,sans-serif);
  --mono-font:var(--vscode-editor-font-family,ui-monospace,SFMono-Regular,Menlo,Consolas,monospace);
  --body-size:var(--vscode-font-size,13px);
}
body{background:var(--page)}
h1{font-size:1.6rem}
`

// docs/index.html, so the exported file and the project page read as one
// product. Light mode follows the reader's system preference.
const DEPWATCH_PALETTE = `
:root{
  --accent:#5aa9e6;--accent2:#4ec9a4;
  --fg:#eef1f8;--muted:#c7cde0;--desc:#aab2c8;--dim:#6b7591;
  --line:#2a3350;--panel:#0d1220;--code:#9be9a8;
  --hover:rgba(90,169,230,.08);--pass:#4ec9a4;--fail:#f2665e;
  --body-font:-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,sans-serif;
  --mono-font:ui-monospace,SFMono-Regular,Menlo,Consolas,monospace;
  --body-size:15px;
}
body{background:linear-gradient(160deg,#0b0f1a,#141b2d 60%,#1b2338)}
h1{font-size:2.1rem;background:linear-gradient(90deg,var(--accent),var(--accent2));
  -webkit-background-clip:text;background-clip:text;color:transparent}
.stat .value{background:linear-gradient(90deg,var(--accent),var(--accent2));
  -webkit-background-clip:text;background-clip:text;color:transparent}
@media (prefers-color-scheme: light){
  :root{
    --fg:#1b2338;--muted:#3d4560;--desc:#4b5470;--dim:#7b849c;
    --line:#dde3f5;--panel:#fff;--code:#0f7a34;--hover:rgba(90,169,230,.12);
  }
  body{background:linear-gradient(160deg,#f6f8ff,#eef1fb 60%,#e9edfc)}
}
`

// Shared by both: the palette decides the colours, this decides the shape.
const LAYOUT = `
*{box-sizing:border-box}
body{margin:0;min-height:100vh;padding:1.6rem 1.4rem;font-family:var(--body-font);font-size:var(--body-size);color:var(--fg)}
.card{max-width:920px;margin:0 auto}
h1{margin:0 0 .3rem;line-height:1.15;display:inline-block}
h2{font-size:1.02rem;margin:2rem 0 .3rem;color:var(--fg);font-family:var(--mono-font);
  border-top:1px solid var(--line);padding-top:1.1rem}
.tagline{font-size:1.02rem;color:var(--muted);margin:0 0 1.3rem;font-weight:500;opacity:.9}
p.desc{color:var(--desc);line-height:1.6;margin:0 0 1rem;font-size:.92em}
p.alt{color:var(--dim);font-size:.85em;margin:0 0 .6rem;line-height:1.5}
code{color:var(--code);font-family:var(--mono-font);font-size:.9em}
.stats{display:flex;gap:.7rem;flex-wrap:wrap;margin:0 0 1.1rem}
.stat{background:var(--panel);border:1px solid var(--line);border-radius:6px;padding:.6rem .9rem;min-width:118px}
.stat.wide{flex:1 1 260px}
.stat .value{font-size:1.45em;font-weight:700;font-family:var(--mono-font)}
.stat .label{font-size:.72em;text-transform:uppercase;letter-spacing:.08em;color:var(--dim);margin-top:.25rem}
.dots{display:flex;gap:.7rem;flex-wrap:wrap;font-size:.9em;font-family:var(--mono-font)}
.dot{display:inline-flex;align-items:center;gap:.35rem;color:var(--desc)}
.dot::before{content:"";width:9px;height:9px;border-radius:50%;background:var(--c)}
.gate{border-radius:6px;padding:.7rem .9rem;margin:0 0 1.1rem;font-size:.92em;border:1px solid var(--line);background:var(--panel)}
.gate.pass{border-left:3px solid var(--pass)}
.gate.fail{border-left:3px solid var(--fail)}
.gate ul{margin:.5rem 0 0;padding-left:1.1rem;color:var(--desc)}
.chart{border:1px solid var(--line);border-radius:6px;overflow:hidden;margin:0 0 1.1rem;background:#0f1319}
.chart svg{display:block;width:100%;height:auto}
table{width:100%;border-collapse:collapse;font-size:.9em;font-family:var(--mono-font);margin:0 0 1rem;display:block;overflow-x:auto}
thead th{text-align:left;color:var(--dim);font-weight:600;border-bottom:1px solid var(--line);
  padding:.4rem .55rem;text-transform:uppercase;font-size:.78em;letter-spacing:.06em;white-space:nowrap;user-select:none}
tbody td{padding:.35rem .55rem;border-bottom:1px solid var(--line);white-space:nowrap}
tbody tr:hover{background:var(--hover)}
td.dep{color:var(--fg)}
td.ver{color:var(--desc)}
td.num,th.num{text-align:right}
.q{font-weight:700}
.bar{position:relative;display:inline-block;min-width:74px;background:var(--hover);border-radius:3px;padding:0 .3rem}
.bar .fill{position:absolute;inset:0 auto 0 0;border-radius:3px;opacity:.35}
.bar .val{position:relative}
.failures{color:var(--desc);font-size:.9em;line-height:1.6}
footer{margin-top:1.8rem;padding-top:.9rem;border-top:1px solid var(--line);color:var(--dim);font-size:.85em;line-height:1.6}
body.clickable tbody tr{cursor:pointer}
body.clickable thead th{cursor:pointer}
`

// Clicking a row jumps to that dependency in the manifest. Sorting is by column
// header. Nothing else — a report that needs a framework is a report that
// stopped being a report.
const CLICK_SCRIPT = `
const vscode = acquireVsCodeApi();
document.body.classList.add('clickable');
document.addEventListener('click', (e) => {
  const th = e.target.closest('th[data-col]');
  if (th) return sort(th);
  const tr = e.target.closest('tr[data-dep]');
  if (tr) vscode.postMessage({ type: 'reveal', file: tr.dataset.file, dep: tr.dataset.dep });
});
function sort(th) {
  const table = th.closest('table');
  const col = Number(th.dataset.col);
  const desc = th.dataset.dir !== 'desc';
  for (const other of table.querySelectorAll('th')) delete other.dataset.dir;
  th.dataset.dir = desc ? 'desc' : 'asc';
  const body = table.querySelector('tbody');
  const rows = [...body.rows].sort((a, b) => {
    const av = key(a.cells[col]), bv = key(b.cells[col]);
    const cmp = typeof av === 'number' && typeof bv === 'number' ? av - bv : String(av).localeCompare(String(bv));
    return desc ? -cmp : cmp;
  });
  for (const row of rows) body.appendChild(row);
}
function key(cell) {
  const text = cell.textContent.trim();
  const n = Number(text);
  return text !== '' && text !== '—' && !Number.isNaN(n) ? n : text;
}
`
