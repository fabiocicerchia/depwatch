// The version fetcher for the five ecosystems the shared @lib registry-client
// already reaches. One factory instead of the same five-line function copied
// into each def.

import { fetchPackage } from '@lib/registry-client'
import type { Ecosystem } from '@lib/semver'
import type { RegistryVersion } from './types.js'

/**
 * Builds the version fetcher for one of the five ecosystems the shared
 * registry-client already reaches.
 *
 * One factory instead of the same five-line function copied into each
 * ecosystem definition.
 *
 * @param eco Which registry the fetcher should ask.
 * @returns A fetcher taking a package name and resolving to its versions.
 */
export function sharedVersions(eco: Ecosystem): (name: string) => Promise<RegistryVersion[]> {
  return async (name) => {
    const info = await fetchPackage(eco, name)
    if ('error' in info) throw new Error(info.error)
    return info.versions
  }
}
