// Java / Kotlin — Maven Central. maven-metadata.xml lists versions cheaply but
// undated; each version's date comes from the Last-Modified of its .pom (a HEAD
// request), hydrated only for the versions scored. Gradle's declarative forms
// and gradle.lockfile are read too.
//
// Maven's version grammar is not the shared dot-integer one — `33.0.0-jre` is a
// stable release, `r03` sorts oldest, `1.0-SNAPSHOT` precedes `1.0` — so this
// def supplies a ComparableVersion-style ordering.

import type { EcosystemDef, RegistryVersion, VersionOps } from './types.js'
import { getText, headLastModified } from './http.js'
import type { Dep } from './parse-util.js'

const CENTRAL = 'https://repo1.maven.org/maven2'
const groupPath = (group: string) => group.replace(/\./g, '/')
// A Maven coordinate is group:artifact in manifests but group/artifact in a PURL
// (namespace/name). Accept both so SBOM components resolve too.
const coord = (name: string): { group: string; artifact: string } => {
  const sep = name.includes(':') ? name.lastIndexOf(':') : name.lastIndexOf('/')
  return { group: name.slice(0, sep), artifact: name.slice(sep + 1) }
}

// --- version ordering (Maven ComparableVersion, pragmatic subset) ---

// Lower rank = older. Release ("", ga, final) sits between rc and sp; unknown
// qualifiers (jre, android) rank after release, per Maven.
const QUALIFIER_RANK: Record<string, number> = {
  alpha: 0, a: 0, beta: 1, b: 1, milestone: 2, m: 2, rc: 3, cr: 3, snapshot: 4,
  '': 5, ga: 5, final: 5, release: 5, sp: 6,
}
const rankOf = (q: string): number => (q in QUALIFIER_RANK ? QUALIFIER_RANK[q] : 7)

function tokenize(v: string): string[] {
  return v
    .toLowerCase()
    .replace(/([0-9])([a-z])/g, '$1.$2')
    .replace(/([a-z])([0-9])/g, '$1.$2')
    .split(/[.\-_+]/)
    .filter((t) => t !== '')
}

const isNum = (t: string) => /^\d+$/.test(t)

function compareToken(a: string | undefined, b: string | undefined): number {
  // A missing token is release when the present one is a qualifier, else zero —
  // so 1.0 < 1.0-sp1 but 1.0 == 1.0.0.
  if (a === undefined) a = b !== undefined && !isNum(b) ? '' : '0'
  if (b === undefined) b = !isNum(a) ? '' : '0'
  const an = isNum(a)
  const bn = isNum(b)
  if (an && bn) {
    const d = Number(a) - Number(b)
    return d === 0 ? 0 : d < 0 ? -1 : 1
  }
  // A numeric item outranks a qualifier at the same position.
  if (an) return 1
  if (bn) return -1
  const ra = rankOf(a)
  const rb = rankOf(b)
  if (ra !== rb) return ra < rb ? -1 : 1
  return a < b ? -1 : a > b ? 1 : 0
}

const mavenOps: VersionOps = {
  compare(a, b) {
    const ta = tokenize(a)
    const tb = tokenize(b)
    for (let i = 0; i < Math.max(ta.length, tb.length); i++) {
      const c = compareToken(ta[i], tb[i])
      if (c !== 0) return c
    }
    return 0
  },
  isPrerelease(v) {
    return /(^|[-_.])(alpha|beta|milestone|m\d|rc|cr|snapshot|preview|pre|dev|ea|b\d|a\d)([-_.]|\d|$)/.test(v.toLowerCase())
  },
}

// --- manifest parsing ---

function parsePom(text: string): Dep[] {
  const deps: Dep[] = []
  const seen = new Set<string>()
  for (const m of text.matchAll(/<dependency>([\s\S]*?)<\/dependency>/g)) {
    const block = m[1]
    const group = block.match(/<groupId>([^<]+)<\/groupId>/)?.[1]?.trim()
    const artifact = block.match(/<artifactId>([^<]+)<\/artifactId>/)?.[1]?.trim()
    const version = block.match(/<version>([^<]+)<\/version>/)?.[1]?.trim()
    // A ${property} version is unresolved without the full model; skip it.
    if (!group || !artifact || !version || version.includes('${')) continue
    const name = `${group}:${artifact}`
    if (seen.has(name)) continue
    seen.add(name)
    deps.push({ name, current: version, resolved: false })
  }
  return deps
}

// Gradle declarative dependencies: implementation 'g:a:v' / api("g:a:v").
function parseGradle(text: string): Dep[] {
  const deps: Dep[] = []
  const seen = new Set<string>()
  for (const m of text.matchAll(/['"]([\w.-]+):([\w.-]+):([\w.\-+]+)['"]/g)) {
    const name = `${m[1]}:${m[2]}`
    if (seen.has(name)) continue
    seen.add(name)
    deps.push({ name, current: m[3], resolved: false })
  }
  return deps
}

// gradle.lockfile: g:a:v=conf1,conf2 (exact).
function parseGradleLock(text: string): Dep[] {
  const deps: Dep[] = []
  const seen = new Set<string>()
  for (const raw of text.split('\n')) {
    const line = raw.trim()
    if (!line || line.startsWith('#') || line.startsWith('empty=')) continue
    const m = line.match(/^([\w.-]+):([\w.-]+):([^=]+)=/)
    if (!m) continue
    const name = `${m[1]}:${m[2]}`
    if (seen.has(name)) continue
    seen.add(name)
    deps.push({ name, current: m[3].trim(), resolved: true })
  }
  return deps
}

export const maven: EcosystemDef = {
  id: 'maven',
  label: 'Maven Central',
  purlTypes: ['maven'],
  manifests: ['pom.xml', 'build.gradle', 'build.gradle.kts'],
  locks: ['gradle.lockfile'],
  versionOps: mavenOps,
  parse(text, base) {
    if (base === 'gradle.lockfile') return parseGradleLock(text)
    if (base.startsWith('build.gradle')) return parseGradle(text)
    return parsePom(text)
  },
  async fetchVersions(name) {
    const { group, artifact } = coord(name)
    const xml = await getText(`${CENTRAL}/${groupPath(group)}/${artifact}/maven-metadata.xml`)
    const versions = [...xml.matchAll(/<version>([^<]+)<\/version>/g)].map((m) => m[1].trim())
    return versions.map((version): RegistryVersion => ({ version, released: null }))
  },
  async hydrateDates(name, versions) {
    const { group, artifact } = coord(name)
    const base = `${CENTRAL}/${groupPath(group)}/${artifact}`
    const out = new Map<string, string>()
    await Promise.all(
      versions.map(async (v) => {
        const iso = await headLastModified(`${base}/${v}/${artifact}-${v}.pom`)
        if (iso) out.set(v, iso)
      }),
    )
    return out
  },
}

export { mavenOps }
