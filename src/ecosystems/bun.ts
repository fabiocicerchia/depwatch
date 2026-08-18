// Bun lockfiles. bun.lock (Bun >= 1.2) is JSONC — JSON with comments and
// trailing commas — and resolves against npm, so it extends the npm def.
// bun.lockb is a binary format with no text representation this tool can read.

import type { Dep } from './parse-util.js'

// The last "@" starts the version; a leading one belongs to an npm scope.
function splitSpec(spec: string): { name: string; version: string } | null {
  const at = spec.lastIndexOf('@')
  if (at <= 0) return null
  return { name: spec.slice(0, at), version: spec.slice(at + 1) }
}

// Tolerant JSONC: strip line/block comments and trailing commas, then JSON.parse.
function parseJsonc(text: string): any {
  const noComments = text
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/(^|[^:])\/\/.*$/gm, '$1')
  const noTrailingCommas = noComments.replace(/,(\s*[}\]])/g, '$1')
  try {
    return JSON.parse(noTrailingCommas)
  } catch {
    return null
  }
}

export function parseBunLock(text: string): Dep[] {
  const doc = parseJsonc(text)
  const packages = doc?.packages
  if (!packages || typeof packages !== 'object') return []
  const deps: Dep[] = []
  const seen = new Set<string>()
  for (const entry of Object.values<any>(packages)) {
    // Each value is an array whose first element is "name@version".
    const spec = Array.isArray(entry) ? entry[0] : undefined
    if (typeof spec !== 'string') continue
    const parsed = splitSpec(spec)
    if (!parsed || !/^\d/.test(parsed.version) || seen.has(parsed.name)) continue
    seen.add(parsed.name)
    deps.push({ name: parsed.name, current: parsed.version, resolved: true })
  }
  return deps
}

export function bunBinaryError(): never {
  throw new Error(
    'bun.lockb is a binary lockfile depwatch cannot read — run `bun install --save-text-lockfile` to emit bun.lock, or point depwatch at package.json',
  )
}
