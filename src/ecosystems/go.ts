// Go modules — the module proxy. `@v/list` returns versions cheaply but
// undated; each version's date needs one `@v/<v>.info` request, so this def
// hydrates dates only for the versions actually scored. Pseudo-versions carry
// their own timestamp in the string and cost no request.

import type { EcosystemDef, RegistryVersion } from './types.js'
import { getJson, getText } from './http.js'
import type { Dep } from './parse-util.js'

const PROXY = 'https://proxy.golang.org'

// Proxy paths lowercase-escape capitals as "!" + lower (github.com/Azure ->
// github.com/!azure) so a case-insensitive store stays unambiguous.
function escapeModule(mod: string): string {
  return mod.replace(/[A-Z]/g, (c) => `!${c.toLowerCase()}`)
}

// A pseudo-version encodes its commit time: v0.0.0-20210101120000-abcdef123456
// or v1.2.3-0.20210101120000-abcdef. The 14 digits are YYYYMMDDHHMMSS (UTC).
function pseudoDate(version: string): string | null {
  const m = version.match(/(?:^|-|\.)(\d{14})-[0-9a-f]{12}$/)
  if (!m) return null
  const s = m[1]
  const iso = `${s.slice(0, 4)}-${s.slice(4, 6)}-${s.slice(6, 8)}T${s.slice(8, 10)}:${s.slice(10, 12)}:${s.slice(12, 14)}Z`
  const t = Date.parse(iso)
  return Number.isFinite(t) ? new Date(t).toISOString() : null
}

// go.mod require blocks and single-line requires. The version is the exact
// minimal-version-selection pick, so it is resolved. "// indirect" is a comment.
function parseGoMod(text: string): Dep[] {
  const deps: Dep[] = []
  const seen = new Set<string>()
  let inBlock = false
  for (const raw of text.split('\n')) {
    const line = raw.replace(/\/\/.*$/, '').trim()
    if (!line) continue
    if (line === 'require (') {
      inBlock = true
      continue
    }
    if (inBlock && line === ')') {
      inBlock = false
      continue
    }
    const body = inBlock ? line : line.startsWith('require ') ? line.slice('require '.length) : null
    if (body === null) continue
    const m = body.match(/^(\S+)\s+(v\S+)/)
    if (!m) continue
    const [, name, version] = m
    if (seen.has(name)) continue
    seen.add(name)
    deps.push({ name, current: version, resolved: true })
  }
  return deps
}

// go.sum records a hash per module version, including every version ever seen
// in the graph, so a module legitimately appears several times. It carries no
// notion of "the selected version" and cannot answer "how far behind am I".
const GO_SUM_LINE = /^\S+\s+v\S+(\/go\.mod)?\s+h1:/m

export const go: EcosystemDef = {
  id: 'go',
  label: 'Go modules',
  purlTypes: ['golang', 'go'],
  // Go has no lock file in this tool's sense: minimal version selection already
  // makes the versions in go.mod exact, so go.mod is both the manifest and the
  // resolved set. Declaring go.sum a lock made resolveInput read it instead of
  // go.mod and parse checksum lines with the go.mod parser, which found nothing
  // and reported every Go module as having no dependencies at all.
  manifests: ['go.mod'],
  locks: [],
  // Recognised so that pointing at it gets an explanation rather than "unknown
  // ecosystem", but deliberately not in `manifests`: the editor extension globs
  // what it can score, and go.sum is not scorable.
  manifestPattern: /^go\.sum$/,
  parse: (text) => {
    if (GO_SUM_LINE.test(text)) {
      throw new Error(
        'go.sum is a checksum database, not a version list: it holds a hash per module ' +
          'version and keeps versions no longer selected, so it cannot say how far behind ' +
          'a dependency is. Point depwatch at go.mod, which minimal version selection ' +
          'already resolves to exact versions.',
      )
    }
    return parseGoMod(text)
  },
  async fetchVersions(name) {
    const list = await getText(`${PROXY}/${escapeModule(name)}/@v/list`)
    return list
      .split('\n')
      .map((v) => v.trim())
      .filter(Boolean)
      .map((version): RegistryVersion => ({ version, released: pseudoDate(version) }))
  },
  async hydrateDates(name, versions) {
    const out = new Map<string, string>()
    const mod = escapeModule(name)
    await Promise.all(
      versions.map(async (v) => {
        const local = pseudoDate(v)
        if (local) {
          out.set(v, local)
          return
        }
        try {
          const info = await getJson(`${PROXY}/${mod}/@v/${v}.info`)
          if (info?.Time) out.set(v, new Date(info.Time).toISOString())
        } catch {
          // undatable version stays unknown
        }
      }),
    )
    return out
  },
}
