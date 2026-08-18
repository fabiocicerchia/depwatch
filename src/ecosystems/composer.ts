import { fetchPackage } from '@lib/registry-client'
import type { EcosystemDef } from './types.js'
import { type Dep, baseVersion } from './parse-util.js'
import { getJson } from './http.js'
import { repoUrlOf } from './meta.js'

// composer.lock lists resolved packages under "packages" and "packages-dev".
function parseComposerLock(text: string): Dep[] {
  let json: any
  try {
    json = JSON.parse(text)
  } catch {
    return []
  }
  const deps: Dep[] = []
  for (const section of ['packages', 'packages-dev']) {
    for (const pkg of json?.[section] ?? []) {
      if (pkg?.name && pkg?.version) {
        deps.push({ name: pkg.name, current: String(pkg.version).replace(/^v/, ''), resolved: true })
      }
    }
  }
  return deps
}

function parseComposerJson(text: string): Dep[] {
  let json: any
  try {
    json = JSON.parse(text)
  } catch {
    return []
  }
  const deps: Dep[] = []
  for (const section of ['require', 'require-dev']) {
    for (const [name, range] of Object.entries<unknown>(json?.[section] ?? {})) {
      // php / ext-* are platform requirements, not packages on Packagist.
      if (!name.includes('/')) continue
      const current = baseVersion(String(range))
      if (current) deps.push({ name, current, resolved: false })
    }
  }
  return deps
}

async function shared(name: string) {
  const info = await fetchPackage('composer', name)
  if ('error' in info) throw new Error(info.error)
  return info.versions
}

export const composer: EcosystemDef = {
  id: 'composer',
  label: 'Packagist',
  purlTypes: ['composer'],
  manifests: ['composer.json'],
  locks: ['composer.lock'],
  parse: (text, base) => (base === 'composer.lock' ? parseComposerLock(text) : parseComposerJson(text)),
  fetchVersions: shared,
  async fetchRepoMeta(name) {
    const d = await getJson(`https://repo.packagist.org/packages/${name}.json`)
    const p = d.package
    return {
      repoUrl: repoUrlOf(p?.repository),
      maintainerCount: Array.isArray(p?.maintainers) ? p.maintainers.length : null,
      hasFunding: Array.isArray(p?.funding) && p.funding.length > 0,
    }
  },
}
