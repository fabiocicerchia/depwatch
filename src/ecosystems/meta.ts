// Small helpers shared by the per-ecosystem --deep metadata extractors.

// A repository field is either a URL string or an object with a `url`.
export function repoUrlOf(repo: unknown): string | null {
  const raw = typeof repo === 'string' ? repo : (repo as { url?: string } | null)?.url
  return raw ? String(raw) : null
}

// Normalise a registry date string (ISO, RFC 1123, epoch float) to ISO 8601,
// or null when it cannot be parsed — an undatable version is "unknown", never a
// guess.
export function toIso(value: unknown): string | null {
  if (value == null) return null
  const t = Date.parse(String(value))
  return Number.isFinite(t) ? new Date(t).toISOString() : null
}
