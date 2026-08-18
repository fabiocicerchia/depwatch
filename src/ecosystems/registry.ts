// The one place every ecosystem is listed.
//
// `Record<EcoId, EcosystemDef>` makes the map exhaustive: a new member of EcoId
// with no def, or a def whose id is not in EcoId, fails `npm run typecheck`.
// That is the guarantee the old six-switch layout could not give — one of those
// switches even had a `default:` arm that hid a missing ecosystem at runtime.

import type { EcoId, EcosystemDef } from './types.js'
import { npm } from './npm.js'
import { pypi } from './pypi.js'
import { cargo } from './cargo.js'
import { composer } from './composer.js'
import { rubygems } from './rubygems.js'
import { pub } from './pub.js'
import { hex } from './hex.js'
import { nuget } from './nuget.js'
import { cocoapods } from './cocoapods.js'
import { conda } from './conda.js'
import { helm } from './helm.js'

export const REGISTRY: Record<EcoId, EcosystemDef> = {
  npm,
  pep440: pypi,
  cargo,
  composer,
  rubygems,
  pub,
  hex,
  nuget,
  cocoapods,
  conda,
  helm,
}

export const ALL: EcosystemDef[] = Object.values(REGISTRY)

export const ECO_IDS: EcoId[] = Object.keys(REGISTRY) as EcoId[]

export function byId(id: string): EcosystemDef | null {
  return (REGISTRY as Record<string, EcosystemDef | undefined>)[id] ?? null
}

export function isEcoId(value: string): value is EcoId {
  return value in REGISTRY
}

// Filename → ecosystem. Locks first (a lock name is the reliable signal), then
// exact manifest names, then pattern manifests (requirements*.txt).
export function byFile(file: string): EcosystemDef | null {
  const base = file.split('/').pop() ?? file
  for (const def of ALL) if (def.locks.includes(base)) return def
  for (const def of ALL) if (def.manifests.includes(base)) return def
  for (const def of ALL) if (def.manifestPattern?.test(base)) return def
  return null
}

// PURL type → ecosystem, for SBOM components (replaces sbom.ts PURL_ECOSYSTEM).
const PURL_INDEX: Record<string, EcosystemDef> = {}
for (const def of ALL) for (const t of def.purlTypes) PURL_INDEX[t] = def

export function byPurlType(type: string): EcosystemDef | null {
  return PURL_INDEX[type] ?? null
}

// --- help/doc generation: the CLI and docs read these so they cannot drift ---

export function ecoIdList(): string {
  return ECO_IDS.join('|')
}

// One line per ecosystem: label and the filenames it recognises. Feeds the CLI
// help and can be pasted into docs.
export function coverageLines(): string[] {
  return ALL.map((def) => {
    const names = [...def.manifests, ...(def.manifestPattern ? [manifestPatternLabel(def.id)] : []), ...def.locks]
    return `${def.label}: ${names.join(', ') || '(SBOM / --eco only)'}`
  })
}

function manifestPatternLabel(id: EcoId): string {
  return id === 'pep440' ? 'requirements*.txt' : 'pattern'
}
