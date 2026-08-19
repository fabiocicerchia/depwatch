// Shared HTTP for the ecosystem clients layered on top of @lib.
//
// Failures are thrown here and turned into values ("unknown" in the report) by
// the caller — one unreachable package must degrade, not abort the manifest.
// The shared @lib/registry-client keeps its own copy of this for the five it
// owns; this is the same contract for the rest.

const HEADERS = { Accept: 'application/json', 'User-Agent': 'depwatch' }

/**
 * GETs a URL and parses the response as JSON.
 *
 * @param url     Absolute URL.
 * @param headers Extra request headers, merged over the defaults.
 * @returns The decoded body.
 * @throws On any non-2xx response; the caller turns that into "unknown" for one
 *         dependency rather than aborting the manifest.
 */
export async function getJson(url: string, headers: Record<string, string> = {}): Promise<any> {
  const res = await fetch(url, { headers: { ...HEADERS, ...headers } })
  if (!res.ok) throw new Error(res.status === 404 ? 'not found in registry' : `registry HTTP ${res.status}`)
  return res.json()
}

/**
 * GETs a URL and returns the response body as text.
 *
 * For the registries that answer in XML or plain text rather than JSON.
 *
 * @param url     Absolute URL.
 * @param headers Extra request headers.
 * @returns The body.
 * @throws On any non-2xx response.
 */
export async function getText(url: string, headers: Record<string, string> = {}): Promise<string> {
  const res = await fetch(url, { headers: { 'User-Agent': 'depwatch', ...headers } })
  if (!res.ok) throw new Error(res.status === 404 ? 'not found in registry' : `registry HTTP ${res.status}`)
  return res.text()
}

/**
 * The `Last-Modified` header of a URL, as an ISO 8601 string.
 *
 * Used where a registry dates a version only by the mtime of its artifact
 * (Maven `.pom`). A HEAD request, so no artifact is downloaded to read a date.
 *
 * @param url Absolute URL.
 * @returns The date, or null when the response failed or carried no header.
 */
export async function headLastModified(url: string): Promise<string | null> {
  const res = await fetch(url, { method: 'HEAD', headers: { 'User-Agent': 'depwatch' } })
  if (!res.ok) return null
  const lm = res.headers.get('last-modified')
  return lm ? new Date(lm).toISOString() : null
}
