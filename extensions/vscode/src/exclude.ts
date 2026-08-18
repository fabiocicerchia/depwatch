// What not to scan.
//
// `workspace.findFiles` takes one exclude glob, and passing it means the
// editor's own excludes stop applying — the API is explicit that `files.exclude`
// and `search.exclude` only apply when the argument is `undefined`. So a
// hardcoded exclude does not add to what you have already hidden from the
// editor, it replaces it, and depwatch ends up scanning the folders you told
// VS Code to ignore. Everything here exists to merge the two instead.
//
// Pure, and free of any `vscode` import, so the glob arithmetic is testable.

/** Characters that make a path segment a pattern rather than a name. */
const WILDCARD = /[*?[\]{}!+@]/

/**
 * One glob for `findFiles`. A brace group is how VS Code spells "any of these",
 * and it splits on commas brace-aware, so a member may itself be a group.
 */
export function combine(patterns: string[]): string | undefined {
  const unique = [...new Set(patterns.map((p) => p.trim()).filter(Boolean))]
  if (unique.length === 0) return undefined
  return unique.length === 1 ? unique[0] : `{${unique.join(',')}}`
}

/**
 * The directory names among a set of globs, for deciding whether a file that
 * just changed sits somewhere excluded. File events arrive without `findFiles`
 * having had a say, and a path is cheaper to check by segment than to match
 * against a dozen patterns.
 *
 * Only directories are taken. `**​/package-lock.json` in someone's
 * `search.exclude` means "do not list this in search results", not "do not
 * measure this project", and treating it as an exclusion would quietly stop
 * rescans when the lock file changed.
 */
export function directoryNames(patterns: string[]): Set<string> {
  const names = new Set<string>()
  for (const pattern of patterns) {
    const segments = pattern.split('/').filter(Boolean)
    segments.forEach((segment, i) => {
      if (WILDCARD.test(segment)) return
      // A name in the middle of a pattern is a directory by construction. A
      // trailing one is only a directory if it does not look like a filename —
      // "node_modules" and ".git" do not, "Thumbs.db" does.
      const trailing = i === segments.length - 1
      if (trailing && segment.indexOf('.') > 0) return
      names.add(segment)
    })
  }
  return names
}

export function isExcludedPath(path: string, names: Set<string>): boolean {
  if (names.size === 0) return false
  return path.split(/[/\\]/).some((segment) => names.has(segment))
}
