import { describe, expect, it } from 'vitest'
import { parse } from '../manifest.js'

describe('python: poetry / uv / pyproject', () => {
  it('reads a poetry [tool.poetry.dependencies] table', () => {
    const m = parse(
      'pyproject.toml',
      `[tool.poetry]
name = "app"

[tool.poetry.dependencies]
python = "^3.11"
requests = "^2.31.0"
django = { version = ">=4.2,<5", extras = ["bcrypt"] }

[tool.poetry.group.dev.dependencies]
pytest = "^8.1.0"
`,
    )
    expect(m.ecosystem).toBe('pep440')
    expect(m.deps).toEqual([
      { name: 'requests', current: '2.31.0', resolved: false },
      { name: 'django', current: '4.2', resolved: false },
      { name: 'pytest', current: '8.1.0', resolved: false },
    ])
  })

  it('reads a PEP 621 [project] dependencies array (uv/pip)', () => {
    const m = parse(
      'pyproject.toml',
      `[project]
name = "app"
requires-python = ">=3.11"
dependencies = [
  "requests>=2.31.0",
  "httpx==0.27.0",
  "rich",
]

[tool.black]
line-length = 100
`,
    )
    // "rich" has no version floor, and [tool.black] must not be swept in.
    expect(m.deps).toEqual([
      { name: 'requests', current: '2.31.0', resolved: false },
      { name: 'httpx', current: '0.27.0', resolved: true },
    ])
  })

  it('reads exact versions from poetry.lock / uv.lock', () => {
    const lock = `[[package]]
name = "certifi"
version = "2024.2.2"

[[package]]
name = "charset-normalizer"
version = "3.3.2"
source = { registry = "https://pypi.org/simple" }
`
    for (const file of ['poetry.lock', 'uv.lock']) {
      const m = parse(file, lock)
      expect(m.ecosystem).toBe('pep440')
      expect(m.deps).toEqual([
        { name: 'certifi', current: '2024.2.2', resolved: true },
        { name: 'charset-normalizer', current: '3.3.2', resolved: true },
      ])
    }
  })
})

describe('bun', () => {
  it('reads bun.lock JSONC (comments, trailing commas)', () => {
    const m = parse(
      'bun.lock',
      `{
  // bun text lockfile
  "lockfileVersion": 1,
  "packages": {
    "react": ["react@18.3.1", "", {}, "sha512-aaa"],
    "@remix-run/router": ["@remix-run/router@1.15.0", "", {}, "sha512-bbb"],
  },
}`,
    )
    expect(m.ecosystem).toBe('npm')
    expect(m.deps).toEqual([
      { name: 'react', current: '18.3.1', resolved: true },
      { name: '@remix-run/router', current: '1.15.0', resolved: true },
    ])
  })

  it('gives an actionable error for the binary bun.lockb', () => {
    expect(() => parse('bun.lockb', ' binary')).toThrow(/save-text-lockfile/)
  })
})
