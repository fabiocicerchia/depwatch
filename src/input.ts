// Turning a path the user pointed at into the manifest depwatch should measure.
//
// Three decisions live here, and every surface needs all three to agree:
// which file actually gets read (the lock file beside the manifest, usually),
// which dependencies count (the ones the manifest chose, at the versions the
// lock resolved), and what the user has to be told about both. The CLI prints
// those notes to stderr; the editor extension shows them on the report.

import { existsSync, readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { basename, detectEcosystem, LOCK_FOR, type Manifest, parse, type SupportedEcosystem } from './manifest.js'

export interface InputOptions {
  eco?: SupportedEcosystem
  noLock?: boolean
  transitive?: boolean
  // Reading through the host rather than the disk: an editor already holds the
  // file in memory, and re-reading it on every scan is disk traffic for a
  // string it could have handed over.
  fs?: InputFs
}

export interface InputFs {
  exists(path: string): boolean
  read(path: string): string
}

const NODE_FS: InputFs = { exists: existsSync, read: (p) => readFileSync(p, 'utf8') }

export interface LoadedManifest {
  manifest: Manifest
  /** The file actually read — the lock file, when one was picked up. */
  input: string
  /** What the caller should tell the user about how this was read. */
  notes: string[]
}

// A manifest range gives its floor, not the installed version, so drift read
// from one is an upper bound. If the lock file is sitting right next to it, use
// that instead — silently reporting a worse number than reality is not a
// conservative default, it is a wrong one.
export function resolveInput(file: string, opts: InputOptions = {}): string {
  if (opts.noLock) return file
  const fs = opts.fs ?? NODE_FS
  const eco = opts.eco ?? detectEcosystem(file)
  if (!eco) return file
  const base = basename(file)
  if (LOCK_FOR[eco].includes(base)) return file // already a lock file
  for (const lock of LOCK_FOR[eco]) {
    const candidate = join(dirname(file), lock)
    if (fs.exists(candidate)) return candidate
  }
  return file
}

export function loadManifest(file: string, opts: InputOptions = {}): LoadedManifest {
  const fs = opts.fs ?? NODE_FS
  const input = resolveInput(file, opts)
  const text = fs.read(input)
  const manifest = parse(input, text, opts.eco ?? detectEcosystem(input) ?? undefined, opts.transitive)
  const notes: string[] = []

  if (manifest.sbom) {
    const skipped = Object.entries(manifest.sbom.skipped).sort((a, b) => b[1] - a[1])
    const parts = [`${manifest.sbom.format} SBOM: ${manifest.deps.length} scorable components`]
    if (manifest.sbom.scoped) parts.push(`direct only, of ${manifest.sbom.total} (--transitive for all)`)
    if (skipped.length > 0) {
      parts.push(`skipped ${skipped.map(([t, n]) => `${n} ${t}`).join(', ')} — no public registry this tool can query`)
    }
    notes.push(parts.join('; '))
  }

  // A lock file lists the whole transitive tree. libyear is a statement about
  // the dependencies you chose, so when the lock was found next to a manifest,
  // the manifest decides WHICH deps count and the lock decides WHICH VERSIONS
  // they are. Without this the number silently changes meaning — 14 direct deps
  // become 215 including transitives — and stops being comparable to anything.
  if (input !== file && !opts.transitive && !manifest.sbom) {
    const direct = new Set(parse(file, fs.read(file), opts.eco ?? undefined).deps.map((d) => d.name))
    manifest.deps = manifest.deps.filter((d) => direct.has(d.name))
    manifest.file = `${file} + ${basename(input)}`
  }
  if (input !== file) {
    notes.push(
      `exact versions from ${basename(input)}${opts.transitive ? ' (whole tree)' : ' (direct dependencies only; --transitive for the full tree)'}`,
    )
  }

  if (manifest.deps.length === 0) {
    throw new Error(
      manifest.sbom
        ? `${input}: the SBOM parsed, but none of its components come from a registry this tool can query`
        : `no dependencies found in ${input}`,
    )
  }
  return { manifest, input, notes }
}
