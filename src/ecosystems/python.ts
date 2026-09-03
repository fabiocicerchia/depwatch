// Python manifests beyond requirements.txt: Poetry and PEP 621 pyproject.toml,
// and the Poetry/uv lock files. All resolve against PyPI, so they extend the
// pep440 def rather than forming a separate registry.

import { type Dep, baseVersion, parsePep508 } from './parse-util.js'

const isPythonPlatformReq = (name: string) => name.toLowerCase() === 'python'

// Poetry states a version two ways — `requests = "^2.31"` and
// `django = { version = ">=4,<5", extras = [...] }` — and both give the floor.
function poetryVersion(rhs: string): string | null {
  const version = rhs.startsWith('{')
    ? rhs.match(/version\s*=\s*["']([^"']+)["']/)?.[1]
    : rhs.match(/^["']([^"']+)["']/)?.[1]
  return version ? baseVersion(version) : null
}

// [tool.poetry.dependencies] and [tool.poetry.group.<g>.dependencies]:
//   requests = "^2.31"
//   django = { version = ">=4,<5", extras = ["bcrypt"] }
function parsePoetryPyproject(text: string): Dep[] {
  const deps: Dep[] = []
  const seen = new Set<string>()
  let inDeps = false
  for (const raw of text.split('\n')) {
    const line = raw.replace(/#.*$/, '').trim()
    if (!line) continue
    if (line.startsWith('[')) {
      const header = line.replace(/^\[+|\]+$/g, '')
      inDeps = header === 'tool.poetry.dependencies' || /^tool\.poetry\.group\..+\.dependencies$/.test(header)
      continue
    }
    if (!inDeps) continue
    const m = line.match(/^["']?([A-Za-z0-9._-]+)["']?\s*=\s*(.+)$/)
    if (!m) continue
    const [, name, rhs] = m
    if (isPythonPlatformReq(name) || seen.has(name)) continue
    const current = poetryVersion(rhs)
    if (current) {
      seen.add(name)
      deps.push({ name, current, resolved: false })
    }
  }
  return deps
}

// PEP 621 [project] dependencies = [ "requests>=2.31", ... ] and
// [project.optional-dependencies] groups. What uv and modern pip read.
function parsePep621Pyproject(text: string): Dep[] {
  const deps: Dep[] = []
  const seen = new Set<string>()
  // Collect every dependency array under [project]. The arrays can span lines.
  const arrays = [...text.matchAll(/(?:^|\n)\s*(?:dependencies|[A-Za-z0-9._-]+)\s*=\s*\[([^\]]*)\]/g)]
  // Restrict to those appearing after a [project] header and before the next
  // non-project top-level table, so [tool.*] arrays are not swept in.
  const projectStart = text.search(/(^|\n)\s*\[project(\.optional-dependencies)?\]/)
  if (projectStart === -1) return deps
  for (const m of arrays) {
    if ((m.index ?? 0) < projectStart) continue
    for (const raw of m[1].split(',')) {
      const s = raw.trim().replace(/^["']|["']$/g, '')
      if (!s) continue
      const dep = parsePep508(s)
      if (dep && !isPythonPlatformReq(dep.name) && !seen.has(dep.name)) {
        seen.add(dep.name)
        deps.push(dep)
      }
    }
  }
  return deps
}

// pyproject.toml is read by both Poetry and uv/pip. Dispatch on the table that
// is actually present rather than on the filename, as planned.
export function parsePyproject(text: string): Dep[] {
  if (/\[tool\.poetry(\.|])/.test(text)) return parsePoetryPyproject(text)
  return parsePep621Pyproject(text)
}
