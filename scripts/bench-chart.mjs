// Turns `vitest bench --outputJson` into the figure in docs/performance.md.
//
// A dot plot rather than bars, because the numbers span three orders of
// magnitude: bar length encodes from a zero baseline, and a log axis breaks
// that, so a bar chart here is either a log chart that lies or a linear chart
// where the fastest mark is a single pixel. A dot encodes by position, which
// survives a log axis honestly. One hue, because this is one measure —
// milliseconds — not four series that need telling apart.
//
// Same palette and the same plain-SVG approach as src/quadrant.ts, so the two
// figures in docs/ read as one product and neither needs a toolchain.
//
// Usage: node scripts/bench-chart.mjs <bench.json> <out.svg>

import { readFileSync, writeFileSync } from 'node:fs'

const BG = '#0f1319'
const GRID = '#20252e'
const MUTED = '#6b7585'
const TEXT = '#aab3c2'
// One hue: this is one measure, milliseconds, not four series to tell apart.
// The spread mark is the same hue at low opacity for the same reason.
const ACCENT = '#4ec9a4'

const W = 760
const PAD = { l: 300, r: 76, t: 52, b: 46 }
const ROW = 34

const esc = (s) =>
  String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&apos;' })[c])

const r2 = (n) => Math.round(n * 100) / 100

// Milliseconds, at the precision the number deserves: 0.17 and 30 want
// different decimals, and trailing zeros read as false precision.
const ms = (n) => (n >= 10 ? n.toFixed(0) : n >= 1 ? n.toFixed(1) : n.toFixed(2))

// Axis ticks carry no unit — the subtitle already says milliseconds, and
// "0.10 ms · 1.0 ms · 10 ms" reads as three different precisions.
const tick = (n) => String(Number(n.toPrecision(2)))

function rows(json) {
  const out = []
  for (const file of json.files ?? []) {
    for (const group of file.groups ?? []) {
      // "src/perf.bench.ts > render" -> "render"
      const phase = group.fullName.split('>').pop().trim()
      for (const b of group.benchmarks ?? []) {
        out.push({ phase, name: b.name, mean: b.mean, min: b.min, p99: b.p99 })
      }
    }
  }
  return out
}

function render(data) {
  const H = PAD.t + data.length * ROW + PAD.b
  const innerW = W - PAD.l - PAD.r

  // Log, because the range is ~175x. Clamped to a decade below the fastest mark
  // so nothing lands on the axis itself.
  const lo = Math.log10(Math.min(...data.map((d) => d.min)) / 1.6)
  const hi = Math.log10(Math.max(...data.map((d) => d.p99)) * 1.3)
  const x = (v) => PAD.l + ((Math.log10(v) - lo) / (hi - lo)) * innerW

  const parts = []
  parts.push(`<rect width="${W}" height="${H}" fill="${BG}"/>`)
  parts.push(
    text(24, 24, 'What a scan costs', { size: 13, fill: TEXT, anchor: 'start' }),
    text(24, 40, 'median of a warm run, milliseconds — lower is better', { size: 10, fill: MUTED, anchor: 'start' }),
  )

  // Recessive decade gridlines, drawn first.
  for (let d = Math.ceil(lo); d <= hi; d++) {
    const v = 10 ** d
    parts.push(
      `<line x1="${r2(x(v))}" y1="${PAD.t - 8}" x2="${r2(x(v))}" y2="${H - PAD.b + 4}" stroke="${GRID}" stroke-width="1"/>`,
    )
    parts.push(text(x(v), H - PAD.b + 20, tick(v), { size: 10, fill: MUTED }))
  }

  let seen = null
  data.forEach((d, i) => {
    const y = PAD.t + i * ROW + ROW / 2

    // The phase, once, above its first row — a repeated label is noise.
    if (d.phase !== seen) {
      seen = d.phase
      parts.push(text(24, y - 12, d.phase, { size: 10, fill: MUTED, anchor: 'start', spaced: true }))
    }
    parts.push(text(PAD.l - 14, y + 3.5, d.name, { size: 11, fill: TEXT, anchor: 'end' }))

    // min → p99, so the figure says how steady the number is and not only what
    // it is. 2px, recessive, under the mark.
    parts.push(
      `<line x1="${r2(x(d.min))}" y1="${r2(y)}" x2="${r2(x(d.p99))}" y2="${r2(y)}" stroke="${ACCENT}" stroke-opacity="0.28" stroke-width="2" stroke-linecap="round"/>`,
    )
    // 10px mark, with a surface ring so it stays readable where it sits on the
    // spread line or a gridline.
    parts.push(
      `<circle cx="${r2(x(d.mean))}" cy="${r2(y)}" r="5" fill="${ACCENT}" stroke="${BG}" stroke-width="2"/>`,
    )
    // Direct-labelled: four rows, and a log axis you have to eyeball is worse
    // than the number written down.
    parts.push(text(W - PAD.r + 12, y + 3.5, `${ms(d.mean)} ms`, { size: 11, fill: TEXT, anchor: 'start' }))
  })

  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${W} ${H}" width="${W}" height="${H}" role="img" aria-label="${esc(
    ariaLabel(data),
  )}">${parts.join('')}</svg>`
}

// The figure, in one sentence, for anyone not reading it with their eyes.
function ariaLabel(data) {
  const each = data.map((d) => `${d.name}, ${ms(d.mean)} milliseconds`).join('; ')
  return `Benchmark latencies, log scale. ${each}.`
}

function text(tx, ty, content, o) {
  const anchor = o.anchor ?? 'middle'
  const spacing = o.spaced ? ' letter-spacing="0.08em"' : ''
  return `<text x="${r2(tx)}" y="${r2(ty)}" font-size="${o.size}" fill="${o.fill}" text-anchor="${anchor}" font-family="ui-monospace, monospace"${spacing}>${esc(
    content,
  )}</text>`
}

const [, , input, output] = process.argv
if (!input || !output) {
  console.error('usage: node scripts/bench-chart.mjs <bench.json> <out.svg>')
  process.exit(1)
}

const data = rows(JSON.parse(readFileSync(input, 'utf8')))
if (data.length === 0) {
  console.error('no benchmarks in the json — did `vitest bench` actually run?')
  process.exit(1)
}
// Trailing newline: the tree is checked by end-of-file-fixer, and a generated
// file that fails the hook every time it is regenerated is a generator bug.
writeFileSync(output, `${render(data)}\n`)
console.log(`${output}: ${data.length} benchmarks`)
