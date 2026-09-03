// SBOM input: CycloneDX and SPDX.
//
// An SBOM is the ideal input for this metric and better than a lock file in two
// ways. It records *resolved* versions, which is what drift has to be measured
// from — and it is ecosystem-agnostic, so one file covers a polyglot repo that
// would otherwise need a package-lock plus a Cargo.lock plus a composer.lock.
//
// It also arrives for free wherever syft already runs, which for this repo is
// the weekly base-image scan.
//
// Two things an SBOM brings that a lock file does not, both handled here:
//
//   * Components from ecosystems with no reachable registry — Go modules,
//     GitHub Actions, OS packages. These are counted and reported, never
//     silently dropped, because "your SBOM has 400 components and depwatch
//     scored 12" needs an explanation on the page rather than in an issue.
//   * A dependency graph. The root component's direct dependencies can be
//     recovered from it, so the same direct-versus-transitive distinction the
//     lock files get applies here too.

import type { Dep } from '@lib/libyear/engine'
import type { EcoId } from './ecosystems/types.js'
import { byPurlType } from './ecosystems/registry.js'

export interface SbomComponent extends Dep {
  ecosystem: EcoId
  ref?: string // bom-ref / SPDXID, for resolving the dependency graph
}

export interface SbomParse {
  format: 'cyclonedx' | 'spdx'
  components: SbomComponent[]
  // Components skipped because no public registry backs their PURL type.
  skipped: Record<string, number>
  // Direct dependencies of the root component, when the SBOM records a graph.
  direct: Set<string> | null
  rootRef?: string
}

/**
 * Splits a package URL into its type, name and version.
 *
 * `pkg:npm/%40remix-run/router@1.23.3` ->
 * `{ type: npm, name: @remix-run/router, version: 1.23.3 }`.
 *
 * @param purl A purl string.
 * @returns The three parts, or null when the string is not a usable purl.
 */
export function parsePurl(purl: string): { type: string; name: string; version: string } | null {
  if (!purl.startsWith('pkg:')) return null
  // Qualifiers and subpath are not part of identity here.
  const body = purl.slice(4).split('#')[0].split('?')[0]
  const slash = body.indexOf('/')
  if (slash === -1) return null

  const type = body.slice(0, slash).toLowerCase()
  const rest = body.slice(slash + 1)

  const at = rest.lastIndexOf('@')
  // A leading "@" belongs to an unencoded npm scope, not a version separator.
  if (at <= 0) return null
  const rawName = rest.slice(0, at)
  const version = decodeURIComponent(rest.slice(at + 1))
  if (!version) return null

  // Namespaces arrive percent-encoded ("%40remix-run/router") or plain.
  const name = rawName
    .split('/')
    .map((segment) => decodeURIComponent(segment))
    .join('/')

  return { type, name, version }
}

/**
 * Identifies which SBOM format a document is, from its contents.
 *
 * @param text The document.
 * @returns The format, or null when it is not an SBOM depwatch reads.
 */
export function detectSbom(text: string): 'cyclonedx' | 'spdx' | null {
  const trimmed = text.trimStart()
  if (!trimmed.startsWith('{')) return null
  try {
    const doc = JSON.parse(trimmed)
    if (doc.bomFormat === 'CycloneDX' || (doc.specVersion && doc.components)) return 'cyclonedx'
    if (typeof doc.spdxVersion === 'string' && doc.spdxVersion.startsWith('SPDX-')) return 'spdx'
  } catch {
    return null
  }
  return null
}

/**
 * Reads a CycloneDX or SPDX document into components and, where recorded, the
 * dependency graph.
 *
 * @param text The document.
 * @returns The parsed SBOM, or null when the format is not recognised.
 */
export function parseSbom(text: string): SbomParse | null {
  const format = detectSbom(text)
  if (!format) return null
  const doc = JSON.parse(text)
  return format === 'cyclonedx' ? parseCycloneDx(doc) : parseSpdx(doc)
}

function collect(
  entries: { purl: string; ref?: string }[],
  format: 'cyclonedx' | 'spdx',
  direct: Set<string> | null,
  rootRef?: string,
): SbomParse {
  const components: SbomComponent[] = []
  const skipped: Record<string, number> = {}
  const seen = new Set<string>()

  for (const { purl, ref } of entries) {
    const parsed = parsePurl(purl)
    if (!parsed) continue
    const def = byPurlType(parsed.type)
    if (!def) {
      skipped[parsed.type] = (skipped[parsed.type] ?? 0) + 1
      continue
    }
    const ecosystem = def.id
    const key = `${ecosystem}:${parsed.name}`
    if (seen.has(key)) continue
    seen.add(key)
    // Every version in an SBOM is a resolved one — that is what an SBOM is for.
    components.push({ name: parsed.name, current: parsed.version, resolved: true, ecosystem, ref })
  }
  return { format, components, skipped, direct, rootRef }
}

function parseCycloneDx(doc: any): SbomParse {
  const rootRef: string | undefined = doc?.metadata?.component?.['bom-ref']
  // Scanning a directory makes syft catalogue the project's own package.json as
  // a component, under a different bom-ref from metadata.component. Matching on
  // the name as well keeps the project from appearing as its own dependency.
  const rootName: string | undefined = doc?.metadata?.component?.name

  // The dependency graph lists, for each ref, what it depends on. The root's
  // entry is therefore the set of direct dependencies.
  let direct: Set<string> | null = null
  if (Array.isArray(doc?.dependencies) && rootRef) {
    const rootEntry = doc.dependencies.find((d: any) => d?.ref === rootRef)
    if (rootEntry && Array.isArray(rootEntry.dependsOn)) direct = new Set<string>(rootEntry.dependsOn)
  }

  const entries = (doc?.components ?? [])
    .filter((c: any) => c?.purl && c['bom-ref'] !== rootRef && !(rootName && c.name === rootName))
    .map((c: any) => ({ purl: c.purl as string, ref: c['bom-ref'] as string | undefined }))

  return collect(entries, 'cyclonedx', direct, rootRef)
}

// The root's direct dependencies, from the relationship list. SPDX states the
// same graph in reverse as often as forwards, so both directions are read:
// DEPENDS_ON from the root, and DEPENDENCY_OF onto it.
function spdxDirectRefs(doc: any, rootRef: string | undefined): Set<string> | null {
  if (!Array.isArray(doc?.relationships) || !rootRef) return null
  const refs = new Set<string>()
  for (const rel of doc.relationships) {
    if (rel?.relationshipType === 'DEPENDS_ON' && rel.spdxElementId === rootRef) refs.add(rel.relatedSpdxElement)
    if (rel?.relationshipType === 'DEPENDENCY_OF' && rel.relatedSpdxElement === rootRef) refs.add(rel.spdxElementId)
  }
  return refs.size > 0 ? refs : null
}

// Every package that carries a purl and is not the document's own root.
function spdxEntries(doc: any, rootRef: string | undefined, rootName: string | undefined) {
  const entries: { purl: string; ref?: string }[] = []
  for (const pkg of doc?.packages ?? []) {
    if (pkg?.SPDXID === rootRef) continue
    if (rootName && pkg?.name === rootName) continue
    const purl = (pkg?.externalRefs ?? []).find((r: any) => r?.referenceType === 'purl')?.referenceLocator
    if (purl) entries.push({ purl, ref: pkg.SPDXID })
  }
  return entries
}

function parseSpdx(doc: any): SbomParse {
  const rootRef: string | undefined = doc?.documentDescribes?.[0]
  const rootName: string | undefined = (doc?.packages ?? []).find((p: any) => p?.SPDXID === rootRef)?.name ?? doc?.name
  return collect(spdxEntries(doc, rootRef, rootName), 'spdx', spdxDirectRefs(doc, rootRef), rootRef)
}

/**
 * Narrows an SBOM to the root's direct dependencies, when it recorded a graph.
 *
 * Same reasoning as the lock files: libyear is a statement about what you
 * chose, and quietly including the transitive tree changes what the number
 * means.
 *
 * @param parsed The parsed SBOM.
 * @returns The direct components, or every component when no graph was
 *          recorded.
 */
export function directOnly(parsed: SbomParse): SbomComponent[] {
  if (!parsed.direct || parsed.direct.size === 0) return parsed.components
  const filtered = parsed.components.filter((c) => c.ref && parsed.direct!.has(c.ref))
  // A graph that matches nothing is more likely malformed than genuinely empty.
  return filtered.length > 0 ? filtered : parsed.components
}

/**
 * Renders the "what was skipped" line for an SBOM containing purl types
 * depwatch has no registry for.
 *
 * Skipped components are reported rather than dropped silently: a total that
 * quietly ignores half the SBOM is not a total.
 *
 * @param skipped Count per purl type.
 * @returns A comma-separated summary, commonest first.
 */
export function skippedSummary(skipped: Record<string, number>): string {
  const parts = Object.entries(skipped)
    .sort((a, b) => b[1] - a[1])
    .map(([type, n]) => `${n} ${type}`)
  return parts.join(', ')
}
