// The one branch worth pinning: without git, "spawn git ENOENT" has to become
// a sentence with the install command in it, and keep the code the editor reads
// to decide whether to offer to run it.

import { describe, expect, it } from 'vitest'
import { INSTALL_GIT, isMissingGit, trend } from './trend.js'

describe('trend without git', () => {
  it('names the install command and stays recognisable', async () => {
    const path = process.env.PATH
    process.env.PATH = ''
    try {
      await expect(trend('package.json', undefined, { cwd: process.cwd() })).rejects.toMatchObject({
        message: `git is not installed. Install it with: ${INSTALL_GIT}`,
        code: 'ENOENT',
      })
    } finally {
      process.env.PATH = path
    }
  })

  it('does not mistake an ordinary git failure for a missing one', () => {
    expect(isMissingGit(Object.assign(new Error('exit 128'), { code: 128 }))).toBe(false)
    expect(isMissingGit(undefined)).toBe(false)
  })
})
