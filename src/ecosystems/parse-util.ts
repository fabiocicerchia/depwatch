// Shared parsing helpers for the manifest/lock readers.

import type { Dep } from '@lib/libyear/engine'
export type { Dep }

/**
 * The leading dotted-numeric run of a range: `"^1.38"` -> `"1.38"`.
 *
 * Used wherever a manifest states a range and its floor is taken as the current
 * version — an upper bound on drift, which is why a lock file is preferred
 * whenever one exists.
 *
 * @param range A version range.
 * @returns The floor version, or null when the range has no numeric part.
 */
export const baseVersion = (range: string): string | null => range.match(/(\d+\.\d+(?:\.\d+)?)/)?.[1] ?? null

/**
 * Reads a TOML array-of-tables lock file.
 *
 * Repeated `[[package]]` blocks, each with `name = "x"` and `version = "y"`,
 * both exact. `Cargo.lock`, `poetry.lock` and `uv.lock` all share this shape,
 * so they share this parser.
 *
 * @param text The lock file.
 * @returns One resolved dependency per package block.
 */
export function parsePackageArrayLock(text: string): Dep[] {
  const deps: Dep[] = []
  const seen = new Set<string>()
  let name: string | null = null
  let inPackage = false
  for (const raw of text.split('\n')) {
    const line = raw.trim()
    if (line === '[[package]]') {
      name = null
      inPackage = true
      continue
    }
    // Any other table header ends the package block (e.g. [[package.metadata]]).
    if (line.startsWith('[') && line !== '[[package]]') {
      inPackage = false
      continue
    }
    if (!inPackage) continue
    const n = line.match(/^name\s*=\s*["']([^"']+)["']/)
    if (n) {
      name = n[1]
      continue
    }
    const v = line.match(/^version\s*=\s*["']([^"']+)["']/)
    if (v && name && !seen.has(name)) {
      seen.add(name)
      deps.push({ name, current: v[1], resolved: true })
      name = null
    }
  }
  return deps
}

/**
 * Reduces a PEP 508 requirement to a name and a version floor.
 *
 * `"requests[security]>=2.0,<3; python_version<'3.9'"` -> `requests` at `2.0`.
 * Shared by `requirements.txt` and PEP 621 `[project]` dependency arrays.
 *
 * @param spec The requirement string.
 * @returns The dependency, or null when the line names no package (a comment,
 *          a `-r` include, a bare option).
 */
export function parsePep508(spec: string): Dep | null {
  const line = spec.split(';')[0].trim() // drop environment markers
  if (!line || line.startsWith('#') || line.startsWith('-')) return null
  const m = line.match(/^([A-Za-z0-9._-]+)\s*(?:\[[^\]]*\])?\s*(==|~=|>=|<=|>|<|!=)?\s*([^,\s]+)?/)
  if (!m) return null
  const [, name, op, version] = m
  const current = version?.match(/\d+(?:\.\d+)*/)?.[0]
  if (!current) return null
  return { name, current, resolved: op === '==' }
}
