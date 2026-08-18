import { fetchPackage } from '@lib/registry-client'
import { detectKind, parseManifest as parseShared } from '@lib/libyear/engine'
import type { EcosystemDef } from './types.js'
import { getJson } from './http.js'
import { repoUrlOf } from './meta.js'
import { bunBinaryError, parseBunLock } from './bun.js'

async function shared(name: string) {
  const info = await fetchPackage('npm', name)
  if ('error' in info) throw new Error(info.error)
  return info.versions
}

export const npm: EcosystemDef = {
  id: 'npm',
  label: 'npm',
  purlTypes: ['npm'],
  manifests: ['package.json'],
  locks: ['package-lock.json', 'yarn.lock', 'pnpm-lock.yaml', 'bun.lock', 'bun.lockb'],
  parse(text, base) {
    if (base === 'bun.lockb') bunBinaryError()
    if (base === 'bun.lock') return parseBunLock(text)
    // Detect rather than trust the filename: a lock read as a manifest (or the
    // reverse) produces a wrong number with no error.
    const kind = detectKind(text)
    if (kind === 'package-lock' || kind === 'yarn-lock' || kind === 'pnpm-lock') return parseShared(text, kind)
    if (base === 'package-lock.json') return parseShared(text, 'package-lock')
    if (base === 'yarn.lock') return parseShared(text, 'yarn-lock')
    if (base === 'pnpm-lock.yaml') return parseShared(text, 'pnpm-lock')
    return parseShared(text, 'npm')
  },
  fetchVersions: shared,
  async fetchRepoMeta(name) {
    const d = await getJson(`https://registry.npmjs.org/${encodeURIComponent(name)}`)
    const latest = d['dist-tags']?.latest
    const manifest = latest ? d.versions?.[latest] : undefined
    return {
      repoUrl: repoUrlOf(d.repository ?? manifest?.repository),
      maintainerCount: Array.isArray(d.maintainers) ? d.maintainers.length : null,
      hasFunding: Boolean(manifest?.funding ?? d.funding),
    }
  },
}
