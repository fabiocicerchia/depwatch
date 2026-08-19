// Small helpers shared by the per-ecosystem --deep metadata extractors.

/**
 * Reads the repository URL out of a registry's `repository` field.
 *
 * Which is either a URL string or an object with a `url` — both shapes are in
 * the wild, sometimes in the same registry.
 *
 * @param repo The raw field.
 * @returns The URL, or null when there is none.
 */
export function repoUrlOf(repo: unknown): string | null {
  const raw = typeof repo === 'string' ? repo : (repo as { url?: string } | null)?.url
  return raw ? String(raw) : null
}

/**
 * Normalises a registry date — ISO, RFC 1123 or an epoch float — to ISO 8601.
 *
 * @param value The raw date field.
 * @returns The ISO string, or null when it cannot be parsed. An undatable
 *          version is "unknown", never a guess: drift is only worth gating on
 *          while it stays objectively computable.
 */
export function toIso(value: unknown): string | null {
  if (value == null) return null
  const t = Date.parse(String(value))
  return Number.isFinite(t) ? new Date(t).toISOString() : null
}
