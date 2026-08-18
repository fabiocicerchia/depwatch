import { describe, expect, it } from 'vitest'
import { combine, directoryNames, isExcludedPath } from './exclude.js'

// VS Code's own defaults, so the merge is tested against what people really have.
const FILES_EXCLUDE = ['**/.git', '**/.svn', '**/.hg', '**/CVS', '**/.DS_Store', '**/Thumbs.db']
const DEPWATCH = ['**/node_modules/**', '**/dist/**', '**/target/**']

describe('combine', () => {
  it('folds several globs into one brace group', () => {
    expect(combine(['**/a/**', '**/b/**'])).toBe('{**/a/**,**/b/**}')
  })

  // A single pattern in a brace group is legal but noisy, and the empty case
  // has to be undefined rather than "" — findFiles reads those differently.
  it('leaves a lone glob alone and gives nothing for none', () => {
    expect(combine(['**/a/**'])).toBe('**/a/**')
    expect(combine([])).toBeUndefined()
    expect(combine(['', '   '])).toBeUndefined()
  })

  it('drops duplicates, which the merge produces constantly', () => {
    expect(combine(['**/node_modules/**', '**/node_modules/**', '**/dist/**'])).toBe(
      '{**/node_modules/**,**/dist/**}',
    )
  })
})

describe('directoryNames', () => {
  it('takes the directories out of depwatch and editor globs alike', () => {
    const names = directoryNames([...DEPWATCH, ...FILES_EXCLUDE])
    expect([...names].sort()).toEqual(['.DS_Store', '.git', '.hg', '.svn', 'CVS', 'dist', 'node_modules', 'target'])
  })

  // The one that matters: plenty of people hide lock files from search results.
  // Reading that as "do not measure this project" would silently stop rescans
  // on the very file whose changes we most need to see.
  it('does not treat an excluded filename as an excluded directory', () => {
    const names = directoryNames(['**/package-lock.json', '**/Thumbs.db', '**/*.log'])
    expect(names.has('package-lock.json')).toBe(false)
    expect(names.has('Thumbs.db')).toBe(false)
    expect(names.size).toBe(0)
  })

  it('keeps a dotfile-looking directory, which has no extension', () => {
    expect(directoryNames(['**/.venv/**', '**/.git']).has('.venv')).toBe(true)
    expect(directoryNames(['**/.git']).has('.git')).toBe(true)
  })

  it('reads a directory in the middle of a pattern even with a dot in it', () => {
    expect(directoryNames(['**/my.folder/**']).has('my.folder')).toBe(true)
  })

  it('ignores segments that are themselves patterns', () => {
    const names = directoryNames(['**/*.tmp/**', 'packages/*/node_modules/**'])
    expect(names.has('node_modules')).toBe(true)
    expect(names.has('packages')).toBe(true)
    expect([...names].some((n) => n.includes('*'))).toBe(false)
  })
})

describe('isExcludedPath', () => {
  const names = directoryNames([...DEPWATCH, ...FILES_EXCLUDE])

  it('matches a whole segment anywhere in the path', () => {
    expect(isExcludedPath('/repo/node_modules/react/package.json', names)).toBe(true)
    expect(isExcludedPath('/repo/apps/api/dist/package.json', names)).toBe(true)
    expect(isExcludedPath('C:\\repo\\target\\package.json', names)).toBe(true)
  })

  it('leaves ordinary paths alone', () => {
    expect(isExcludedPath('/repo/apps/api/package.json', names)).toBe(false)
    expect(isExcludedPath('/repo/package.json', names)).toBe(false)
  })

  // Segment-wise, not substring: a folder called "my-dist-tools" is not "dist".
  it('does not match a partial segment', () => {
    expect(isExcludedPath('/repo/my-dist-tools/package.json', names)).toBe(false)
    expect(isExcludedPath('/repo/node_modules_old/package.json', names)).toBe(false)
  })

  it('excludes nothing when nothing is excluded', () => {
    expect(isExcludedPath('/repo/node_modules/x/package.json', new Set())).toBe(false)
  })
})
