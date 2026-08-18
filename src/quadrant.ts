// The quadrant chart: drift on x, viability on y. This is the product — the one
// picture that says "these four are behind and alive, this one is behind and
// dead". Plain SVG string, same instrument palette as the infra-toolbox charts,
// so it can be committed, attached to a PR, or opened in a browser with no
// toolchain.

import type { DepReport, Quadrant, Thresholds } from './report.js'
import { DEFAULT_THRESHOLDS } from './report.js'

const COLOR: Record<Quadrant, string> = {
  healthy: '#4ec9a4',
  upgrade: '#e8b73a',
  watch: '#5aa9e6',
  replace: '#f2665e',
}

const BG = '#0f1319'
const GRID = '#20252e'
const MUTED = '#6b7585'
const TEXT = '#aab3c2'

const W = 760
const H = 520
const PAD = { l: 62, r: 24, t: 44, b: 52 }

export interface ChartOptions {
  title?: string
  thresholds?: Thresholds
  // Label every point, not just the ones off the healthy quadrant. Off by
  // default: a 200-dep manifest becomes unreadable.
  labelAll?: boolean
}

export function quadrantSVG(deps: DepReport[], opts: ChartOptions = {}): string {
  const t = opts.thresholds ?? DEFAULT_THRESHOLDS
  const plot = deps.filter((d) => !d.degraded && !d.driftUnscored)
  const innerW = W - PAD.l - PAD.r
  const innerH = H - PAD.t - PAD.b

  // Square-root x so the crowded 0–1 libyear range stays legible while a single
  // 8-libyear outlier does not flatten everything else against the axis.
  const maxDrift = Math.max(2, ...plot.map((d) => d.libyearsBehind))
  const x = (libyears: number) => PAD.l + (Math.sqrt(Math.min(libyears, maxDrift)) / Math.sqrt(maxDrift)) * innerW
  const y = (viability: number) => PAD.t + (1 - viability) * innerH

  const xDiv = x(t.staleLibyears)
  const yDiv = y(t.riskyViability)

  const parts: string[] = []
  parts.push(`<rect width="${W}" height="${H}" fill="${BG}"/>`)
  parts.push(
    text(PAD.l, 22, opts.title ?? 'dependency drift × viability', { size: 13, fill: TEXT, anchor: 'start' }),
  )

  // Quadrant tints, drawn first so points sit on top.
  parts.push(band(PAD.l, PAD.t, xDiv - PAD.l, yDiv - PAD.t, COLOR.healthy))
  parts.push(band(xDiv, PAD.t, W - PAD.r - xDiv, yDiv - PAD.t, COLOR.upgrade))
  parts.push(band(PAD.l, yDiv, xDiv - PAD.l, H - PAD.b - yDiv, COLOR.watch))
  parts.push(band(xDiv, yDiv, W - PAD.r - xDiv, H - PAD.b - yDiv, COLOR.replace))

  parts.push(quadLabel(PAD.l + 8, PAD.t + 16, 'healthy', COLOR.healthy))
  parts.push(quadLabel(xDiv + 8, PAD.t + 16, 'upgrade — behind but alive', COLOR.upgrade))
  parts.push(quadLabel(PAD.l + 8, yDiv + 16, 'watch — current but fading', COLOR.watch))
  parts.push(quadLabel(xDiv + 8, yDiv + 16, 'REPLACE — behind and unmaintained', COLOR.replace))

  // Axes and the threshold lines that define the quadrants.
  parts.push(line(PAD.l, PAD.t, PAD.l, H - PAD.b, GRID))
  parts.push(line(PAD.l, H - PAD.b, W - PAD.r, H - PAD.b, GRID))
  parts.push(line(xDiv, PAD.t, xDiv, H - PAD.b, MUTED, '4 3'))
  parts.push(line(PAD.l, yDiv, W - PAD.r, yDiv, MUTED, '4 3'))

  for (const tick of xTicks(maxDrift)) {
    parts.push(text(x(tick), H - PAD.b + 16, fmt(tick), { size: 10, fill: MUTED }))
  }
  for (const v of [0, 0.25, 0.5, 0.75, 1]) {
    parts.push(text(PAD.l - 10, y(v) + 3.5, v.toFixed(2), { size: 10, fill: MUTED, anchor: 'end' }))
  }
  parts.push(text(PAD.l + innerW / 2, H - 12, 'libyears behind →', { size: 11, fill: TEXT }))
  parts.push(
    `<text x="16" y="${PAD.t + innerH / 2}" font-size="11" fill="${TEXT}" text-anchor="middle" font-family="ui-monospace, monospace" transform="rotate(-90 16 ${PAD.t + innerH / 2})">viability →</text>`,
  )

  for (const d of plot) {
    const cx = x(d.libyearsBehind)
    const cy = y(d.viability)
    const c = COLOR[d.quadrant]
    parts.push(`<circle cx="${r2(cx)}" cy="${r2(cy)}" r="4.5" fill="${c}" fill-opacity="0.45" stroke="${c}" stroke-width="1"/>`)
    if (opts.labelAll || d.quadrant !== 'healthy') {
      parts.push(text(cx + 8, cy + 3.5, d.name, { size: 10, fill: c, anchor: 'start' }))
    }
  }

  const skipped = deps.length - plot.length
  if (skipped > 0) {
    parts.push(text(W - PAD.r, 22, `${skipped} not plotted (no registry data)`, { size: 10, fill: MUTED, anchor: 'end' }))
  }

  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${W} ${H}" width="${W}" height="${H}" role="img" aria-label="Dependency drift versus viability quadrant">${parts.join('')}</svg>`
}

function band(bx: number, by: number, bw: number, bh: number, fill: string): string {
  return `<rect x="${r2(bx)}" y="${r2(by)}" width="${r2(Math.max(0, bw))}" height="${r2(Math.max(0, bh))}" fill="${fill}" fill-opacity="0.06"/>`
}

function line(x1: number, y1: number, x2: number, y2: number, stroke: string, dash?: string): string {
  return `<line x1="${r2(x1)}" y1="${r2(y1)}" x2="${r2(x2)}" y2="${r2(y2)}" stroke="${stroke}" stroke-width="1"${dash ? ` stroke-dasharray="${dash}"` : ''}/>`
}

function quadLabel(lx: number, ly: number, label: string, fill: string): string {
  return text(lx, ly, label, { size: 10, fill, anchor: 'start', opacity: 0.75 })
}

function text(
  tx: number,
  ty: number,
  content: string,
  o: { size: number; fill: string; anchor?: 'start' | 'middle' | 'end'; opacity?: number },
): string {
  const anchor = o.anchor ?? 'middle'
  const opacity = o.opacity === undefined ? '' : ` opacity="${o.opacity}"`
  return `<text x="${r2(tx)}" y="${r2(ty)}" font-size="${o.size}" fill="${o.fill}" text-anchor="${anchor}" font-family="ui-monospace, monospace"${opacity}>${escapeXml(content)}</text>`
}

function xTicks(max: number): number[] {
  const step = max <= 3 ? 0.5 : max <= 8 ? 1 : Math.ceil(max / 8)
  const ticks: number[] = []
  for (let t = 0; t <= max + 1e-9; t += step) ticks.push(Math.round(t * 100) / 100)
  return ticks
}

const fmt = (n: number) => (Number.isInteger(n) ? String(n) : n.toFixed(1))
const r2 = (n: number) => Math.round(n * 100) / 100

export function escapeXml(s: string): string {
  return s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&apos;' })[c]!)
}
