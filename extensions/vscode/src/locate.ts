// Finding where a dependency is written down, so a finding can be underlined
// on the line that caused it.
//
// The engine reports names, not positions: it reads lock files and SBOMs, where
// a position would be meaningless. So the text is indexed once per scan and the
// names are looked up in it. One pass, whatever the file, because a
// package-lock.json is measured in megabytes and a regex per dependency over
// one of those is a scan the editor would feel.
//
// No `vscode` import: spans are plain offsets, and the caller turns them into
// ranges.

export interface Span {
  start: number
  end: number
}

type Shape = 'json-sections' | 'requirements' | 'cargo-toml' | 'cargo-lock' | 'gemfile-lock' | 'generic'

// Dependency sections, by the file that has them.
const SECTIONS: Record<string, string[]> = {
  'package.json': ['dependencies', 'devDependencies', 'optionalDependencies'],
  'composer.json': ['require', 'require-dev'],
}

export function shapeOf(filename: string): Shape {
  const base = filename.split(/[/\\]/).pop() ?? filename
  if (SECTIONS[base]) return 'json-sections'
  if (base === 'Cargo.toml') return 'cargo-toml'
  if (base === 'Cargo.lock') return 'cargo-lock'
  if (base === 'Gemfile.lock') return 'gemfile-lock'
  if (/^requirements.*\.txt$/.test(base)) return 'requirements'
  return 'generic'
}

/**
 * Where each of `names` is written in `text`. Names with no obvious home — a
 * transitive dependency that appears in no manifest, say — are simply absent
 * from the result rather than guessed at.
 */
export function locateDeps(text: string, filename: string, names: Iterable<string>): Map<string, Span> {
  const shape = shapeOf(filename)
  const index = buildIndex(text, filename, shape)
  const out = new Map<string, Span>()
  for (const name of names) {
    // The textual fallback is for files with no shape worth parsing — an SBOM.
    // Where the shape IS known, a name the index did not find is a name that is
    // not in the file, and underlining some other line that happens to contain
    // the string is worse than underlining nothing.
    const span =
      index.get(name) ??
      index.get(name.toLowerCase()) ??
      index.get(normalise(name)) ??
      (shape === 'generic' ? fallback(text, name) : undefined)
    if (span) out.set(name, span)
  }
  return out
}

// PyPI treats "-", "_" and case as the same character; nothing else here does,
// so this is only ever a last resort before the textual fallback.
const normalise = (name: string) => name.toLowerCase().replace(/_/g, '-')

function buildIndex(text: string, filename: string, shape: Shape): Map<string, Span> {
  const base = filename.split(/[/\\]/).pop() ?? filename
  switch (shape) {
    case 'json-sections':
      return jsonSections(text, SECTIONS[base] ?? [])
    case 'requirements':
      return byLine(text, /^\s*([A-Za-z0-9._-]+)/)
    case 'cargo-toml':
      return cargoToml(text)
    case 'cargo-lock':
      return byLine(text, /^\s*name\s*=\s*"([^"]+)"/)
    case 'gemfile-lock':
      return byLine(text, /^ {4}([A-Za-z0-9._-]+) \(/)
    default:
      return quotedNames(text)
  }
}

// --- shapes ---

// Keys of the dependency objects in package.json / composer.json. Section-aware
// so a package called "scripts" or a devDependency shadowed elsewhere in the
// file lands on the right line.
function jsonSections(text: string, sections: string[]): Map<string, Span> {
  const out = new Map<string, Span>()
  const top = objectKeys(text, text.indexOf('{'))
  for (const section of sections) {
    const at = top.get(section)
    if (!at) continue
    const brace = text.indexOf('{', at.end)
    if (brace === -1) continue
    for (const [name, span] of objectKeys(text, brace)) if (!out.has(name)) out.set(name, span)
  }
  return out
}

// [dependencies] tables plus the [dependencies.foo] form that names the crate
// in the header itself.
function cargoToml(text: string): Map<string, Span> {
  const out = new Map<string, Span>()
  let inDeps = false
  eachLine(text, (line, offset) => {
    const trimmed = line.replace(/#.*$/, '').trim()
    if (trimmed.startsWith('[')) {
      const segments = trimmed.replace(/^\[+|\]+$/g, '').split('.')
      const last = segments[segments.length - 1]
      const prev = segments[segments.length - 2]
      inDeps = isDepTable(last)
      if (!inDeps && isDepTable(prev) && !out.has(last)) {
        const at = line.lastIndexOf(last)
        out.set(last, { start: offset + at, end: offset + at + last.length })
      }
      return
    }
    if (!inDeps) return
    const m = trimmed.match(/^([A-Za-z0-9._-]+)\s*=/)
    if (!m || out.has(m[1])) return
    const at = line.indexOf(m[1])
    out.set(m[1], { start: offset + at, end: offset + at + m[1].length })
  })
  return out
}

const isDepTable = (segment: string | undefined) =>
  segment === 'dependencies' || segment === 'dev-dependencies' || segment === 'build-dependencies'

function byLine(text: string, pattern: RegExp): Map<string, Span> {
  const out = new Map<string, Span>()
  eachLine(text, (line, offset) => {
    const m = line.match(pattern)
    if (!m || out.has(m[1])) return
    const at = line.indexOf(m[1], m.index ?? 0)
    out.set(m[1], { start: offset + at, end: offset + at + m[1].length })
  })
  return out
}

// --- primitives ---

function eachLine(text: string, visit: (line: string, offset: number) => void): void {
  let offset = 0
  for (const line of text.split('\n')) {
    visit(line, offset)
    offset += line.length + 1
  }
}

/** Every JSON string that is used as a key, anywhere in the document. */
function quotedNames(text: string): Map<string, Span> {
  const out = new Map<string, Span>()
  const re = /"((?:[^"\\]|\\.)*)"\s*:/g
  for (let m = re.exec(text); m !== null; m = re.exec(text)) {
    if (!out.has(m[1])) out.set(m[1], { start: m.index + 1, end: m.index + 1 + m[1].length })
  }
  return out
}

/** The string starting at the quote at `open`: its span, and what follows it. */
function readString(text: string, open: number): { span: Span; after: number } {
  let i = open + 1
  while (i < text.length && text[i] !== '"') i += text[i] === '\\' ? 2 : 1
  return { span: { start: open + 1, end: i }, after: i + 1 }
}

/** A key is a string followed by a colon; a value is not. */
function isKeyAt(text: string, after: number): boolean {
  let i = after
  while (i < text.length && /\s/.test(text[i])) i++
  return text[i] === ':'
}

/**
 * Keys of the object that starts at `open`, and only that object — a walk that
 * tracks depth and string state, so a brace inside a version string does not
 * end the object early.
 */
function objectKeys(text: string, open: number): Map<string, Span> {
  const out = new Map<string, Span>()
  if (open === -1) return out
  let depth = 0
  let i = open
  while (i < text.length) {
    const c = text[i]
    if (c === '"') {
      const { span, after } = readString(text, i)
      const name = text.slice(span.start, span.end)
      if (depth === 1 && isKeyAt(text, after) && !out.has(name)) out.set(name, span)
      i = after
      continue
    }
    if (c === '{' || c === '[') depth++
    else if (c === '}' || c === ']') {
      depth--
      if (depth === 0) break
    }
    i++
  }
  return out
}

// Nothing structural matched — find the name as a quoted string, then as a
// whole word. Used for SBOMs and for anything else this file has no shape for.
function fallback(text: string, name: string): Span | undefined {
  const quoted = text.indexOf(`"${name}"`)
  if (quoted !== -1) return { start: quoted + 1, end: quoted + 1 + name.length }
  const at = text.indexOf(name)
  if (at === -1) return undefined
  const before = text[at - 1]
  const after = text[at + name.length]
  const boundary = (c: string | undefined) => c === undefined || !/[A-Za-z0-9._@/-]/.test(c)
  return boundary(before) && boundary(after) ? { start: at, end: at + name.length } : undefined
}
