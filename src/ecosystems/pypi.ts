import { sharedVersions } from './shared.js'
import { parseManifest as parseShared } from '@lib/libyear/engine'
import { parsePyproject } from './python.js'
import { parsePackageArrayLock } from './parse-util.js'
import type { EcosystemDef } from './types.js'
import { getJson } from './http.js'
import { repoUrlOf } from './meta.js'

export const pypi: EcosystemDef = {
  id: 'pep440',
  label: 'PyPI',
  purlTypes: ['pypi'],
  manifests: ['pyproject.toml'],
  manifestPattern: /^requirements/,
  // Poetry and uv both pin exact versions; preferred over pyproject ranges.
  locks: ['poetry.lock', 'uv.lock'],
  parse(text, base) {
    if (base === 'poetry.lock' || base === 'uv.lock') return parsePackageArrayLock(text)
    if (base === 'pyproject.toml') return parsePyproject(text)
    return parseShared(text, 'pep440') // requirements*.txt
  },
  fetchVersions: sharedVersions('pep440'),
  async fetchRepoMeta(name) {
    const d = await getJson(`https://pypi.org/pypi/${encodeURIComponent(name)}/json`)
    const urls: Record<string, string> = d.info?.project_urls ?? {}
    const repo = Object.entries(urls).find(([k]) => /source|repo|code|github/i.test(k))?.[1] ?? d.info?.home_page
    return {
      repoUrl: repoUrlOf(repo),
      maintainerCount: null, // PyPI exposes a free-text author, not a maintainer list
      hasFunding: Object.keys(urls).some((k) => /fund|sponsor|donat/i.test(k)),
    }
  },
}
