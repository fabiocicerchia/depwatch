// Small helpers shared by the per-ecosystem --deep metadata extractors.

// A repository field is either a URL string or an object with a `url`.
export function repoUrlOf(repo: unknown): string | null {
  const raw = typeof repo === 'string' ? repo : (repo as { url?: string } | null)?.url
  return raw ? String(raw) : null
}

// Strip a leading "v" and any build/qualifier so the shared dot-integer
// comparator sees a clean core. Used by registries that prefix tags with "v".
export const stripV = (v: string): string => v.trim().replace(/^v/i, '')
