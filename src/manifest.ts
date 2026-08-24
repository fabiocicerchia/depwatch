// Manifest detection and parsing.
//
// This is now a thin layer over the ecosystem registry (src/ecosystems): the
// per-ecosystem filename lists and parsers live in one def each, and this file
// dispatches to them. SBOM input is handled here because an SBOM has no
// conventional filename and each of its components carries its own ecosystem.

import type { Dep } from '@lib/libyear/engine'
import type { EcoId } from './ecosystems/types.js'
import { ALL, byFile, byId, ECO_IDS, isEcoId } from './ecosystems/registry.js'
import { detectSbom, directOnly, parseSbom, type SbomParse } from './sbom.js'

// Kept as the public name the CLI and trend mode already import.
export type SupportedEcosystem = EcoId

// The lock file that belongs beside a given manifest, in preference order.
// Derived from the registry so it cannot drift from the parsers.
export const LOCK_FOR: Record<SupportedEcosystem, string[]> = Object.fromEntries(
  ALL.map((def) => [def.id, def.locks]),
) as Record<SupportedEcosystem, string[]>

export const SUPPORTED_ECOSYSTEMS: SupportedEcosystem[] = ECO_IDS

/**
 * Narrows a user-supplied string to a known ecosystem, or throws.
 *
 * The CLI takes `--eco` from the command line, where a typo is a string like
 * any other. Without this the value would be cast straight to the union type
 * and reach a lookup that matches nothing, producing an empty dependency list —
 * "your manifest is clean" is the worst possible answer to a misspelt flag.
 *
 * @param value The raw flag value.
 * @returns The same string, typed.
 * @throws When the ecosystem is not one depwatch supports.
 */
export function assertEcosystem(value: string): SupportedEcosystem {
  if (isEcoId(value)) return value
  throw new Error(`unsupported ecosystem "${value}" (want one of: ${SUPPORTED_ECOSYSTEMS.join(', ')})`)
}

export interface Manifest {
  ecosystem: SupportedEcosystem
  file: string
  deps: Dep[]
  // Present when the input was an SBOM: which components were skipped for want
  // of a reachable registry, and whether the graph narrowed it to direct deps.
  sbom?: { format: string; skipped: Record<string, number>; total: number; scoped: boolean }
}

/**
 * The final segment of a path, splitting on either separator.
 *
 * Both separators: the CLI is handed POSIX paths, the editor extension is
 * handed whatever the host uses, and a Windows path read as one long filename
 * detects no ecosystem at all.
 *
 * @param file A path in either flavour.
 * @returns The filename.
 */
export const basename = (file: string): string => file.split(/[/\\]/).pop() ?? file

/**
 * Guesses the ecosystem from a manifest's filename.
 *
 * Filenames are the reliable signal; content sniffing is not needed because
 * every ecosystem here has a conventional manifest name.
 *
 * @param file Path or filename.
 * @returns The ecosystem, or null when the name is not recognised.
 */
export function detectEcosystem(file: string): SupportedEcosystem | null {
  return byFile(file)?.id ?? null
}

/**
 * Reads a manifest or lock file into the dependency list depwatch scores.
 *
 * @param file       Path, used to detect the ecosystem when none is given.
 * @param text       The file's contents.
 * @param ecosystem  Overrides detection, for stdin and misnamed files.
 * @param transitive Include the whole resolved tree rather than direct
 *                   dependencies only. Off by default: libyear is a statement
 *                   about what you chose, and the transitive tree changes what
 *                   the number means.
 * @returns The parsed manifest.
 */
export function parse(file: string, text: string, ecosystem?: SupportedEcosystem, transitive = false): Manifest {
  // Detected from content: an SBOM has no conventional filename, and bom.json
  // would otherwise be read as a package.json and yield nothing at all.
  if (detectSbom(text)) {
    const parsed = parseSbom(text) as SbomParse
    const chosen = transitive ? parsed.components : directOnly(parsed)
    return {
      // Nominal only — each dep carries its own ecosystem.
      ecosystem: chosen[0]?.ecosystem ?? 'npm',
      file,
      deps: chosen,
      sbom: {
        format: parsed.format,
        skipped: parsed.skipped,
        total: parsed.components.length,
        scoped: chosen.length < parsed.components.length,
      },
    }
  }

  const def = ecosystem ? byId(ecosystem) : byFile(file)
  if (!def)
    throw new Error(`unrecognised input: ${file} (expected a manifest, a lock file, or a CycloneDX/SPDX SBOM)`)
  return { ecosystem: def.id, file, deps: def.parse(text, basename(file)) }
}
