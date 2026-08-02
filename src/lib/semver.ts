// Version handling shared by the libyear engine and the registry client.
//
// Five ecosystems, one comparator. npm semver, PEP 440, Cargo, Composer and
// RubyGems all lead with dot-separated integers, and that leading run is the
// only part libyear needs — everything after it just decides stable versus
// prerelease. A per-ecosystem parser would be five times the code for a
// distinction this metric never makes.

export type Ecosystem = 'npm' | 'pep440' | 'cargo' | 'composer' | 'rubygems'

export const ECOSYSTEMS: Ecosystem[] = ['npm', 'pep440', 'cargo', 'composer', 'rubygems']

const strip = (v: string) => v.trim().replace(/^[v=]+/, '')

// The leading dot-separated integers: "2.0.0b1" -> [2,0,0], "1.0.0-rc.2" -> [1,0,0].
export function versionCore(v: string): number[] {
  const m = strip(v).match(/^\d+(?:\.\d+)*/)
  return m ? m[0].split('.').map(Number) : []
}

// Anything trailing the numeric core marks a prerelease — except build metadata
// ("+sha") and PEP 440 post-releases ("1.2.post1"), which ship *after* the
// release they name and are therefore the stabler of the two.
export function isPrerelease(v: string): boolean {
  const rest = strip(v).replace(/^\d+(?:\.\d+)*/, '')
  if (!rest || rest.startsWith('+')) return false
  return !/^[.\-_]?(post|rev|r)\d*$/i.test(rest)
}

// ponytail: prereleases of the same core compare equal (1.0.0-rc.1 vs -rc.2).
// Latest-version selection filters prereleases out first, so this never decides
// anything; give it a real precedence ordering if that stops being true.
export function compareVersions(a: string, b: string): number {
  const [x, y] = [versionCore(a), versionCore(b)]
  for (let i = 0; i < Math.max(x.length, y.length); i++) {
    const d = (x[i] ?? 0) - (y[i] ?? 0)
    if (d !== 0) return d < 0 ? -1 : 1
  }
  // Same numbers: the stable one is the later release (1.0.0 > 1.0.0-rc.1).
  return Number(!isPrerelease(a)) - Number(!isPrerelease(b))
}
