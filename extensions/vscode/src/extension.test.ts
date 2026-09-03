// What activation actually wires up.
//
// activate() is the extension's contract with the editor: which commands exist,
// which files are watched, what goes into subscriptions so it can be torn down.
// None of that is checkable without a `vscode` module, so these run against the
// stub in ./testing/vscode.ts, aliased in by the runner. The assertions are on
// what the extension asked the editor for — never on a variable it set.

import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { activate } from './extension.js'
import { harness, Uri } from './testing/vscode.js'

const manifest = JSON.parse(
  readFileSync(fileURLToPath(new URL('../package.json', import.meta.url)), 'utf8'),
) as { contributes: { commands: { command: string }[]; configuration: { properties: Record<string, unknown> } } }

type Context = Parameters<typeof activate>[0]

let subscriptions: { dispose(): unknown }[]

function context(): Context {
  subscriptions = []
  return {
    subscriptions,
    globalStorageUri: Uri.file('/storage'),
    secrets: {
      get: async (key: string) => harness.secrets.get(key),
      store: async (key: string, value: string) => void harness.secrets.set(key, value),
      delete: async (key: string) => void harness.secrets.delete(key),
    },
  } as unknown as Context
}

const run = (id: string, ...args: unknown[]) => harness.commands.get(id)?.(...args)

/** The startup scan is deliberately not awaited, so let it get going. */
const settle = () => new Promise((resolve) => setTimeout(resolve, 0))

beforeEach(() => {
  harness.reset()
  delete process.env.GITHUB_TOKEN
})

afterEach(() => {
  for (const d of subscriptions ?? []) d.dispose()
  delete process.env.GITHUB_TOKEN
})

describe('activate', () => {
  it('registers every command the manifest contributes', async () => {
    await activate(context())

    const contributed = manifest.contributes.commands.map((c) => c.command)
    expect([...harness.commands.keys()].sort()).toEqual(
      // depwatch.reveal is the webview's own callback: registered, deliberately
      // not contributed, so it never shows in the command palette.
      [...contributed, 'depwatch.reveal'].sort(),
    )
  })

  it('opens the findings view the manifest declares', async () => {
    await activate(context())
    expect(harness.views.get('depwatch.findings')).toBeDefined()
  })

  it('watches the manifests it scans and the locks that change them', async () => {
    harness.config.set('depwatch.manifests', ['**/package.json', '**/Cargo.toml'])
    await activate(context())

    const globs = harness.watchers.map((w) => w.glob)
    expect(globs).toHaveLength(2)
    expect(globs[0]).toContain('package.json')
    expect(globs[0]).toContain('Cargo.toml')
    // A lock file changing is npm install; the manifest did not move but the
    // versions did, so it has to be watched even though it is never scanned.
    expect(globs[0]).toContain('package-lock.json')
    expect(globs[0]).toContain('Cargo.lock')
    // The second watcher is the baseline, which is a file, not a glob group.
    expect(globs[1]).toBe('**/.depwatch-baseline.json')
  })

  it('puts everything it created into subscriptions, so disposal is complete', async () => {
    const ctx = context()
    await activate(ctx)
    expect(harness.commands.size).toBe(manifest.contributes.commands.length + 1)

    // deactivate() is empty on purpose: the editor disposes subscriptions, and
    // a command left registered after that is a command that outlives the
    // extension.
    expect(() => {
      for (const d of ctx.subscriptions) d.dispose()
    }).not.toThrow()
    expect(harness.commands.size).toBe(0)
  })

  it('takes a stored token out of the keychain and into the environment', async () => {
    harness.secrets.set('depwatch.githubToken', 'ghp_stored')
    await activate(context())
    expect(process.env.GITHUB_TOKEN).toBe('ghp_stored')
  })

  it('never overwrites a token the environment already carries', async () => {
    process.env.GITHUB_TOKEN = 'ghp_from_env'
    harness.secrets.set('depwatch.githubToken', 'ghp_stored')
    await activate(context())
    expect(process.env.GITHUB_TOKEN).toBe('ghp_from_env')
  })

  it('scans nothing on startup when the extension is switched off', async () => {
    harness.config.set('depwatch.enable', false)
    harness.config.set('depwatch.manifests', ['**/package.json'])
    harness.found = ['/repo/package.json']
    await activate(context())
    await settle()
    expect(harness.log.join('\n')).not.toContain('manifest(s)')
  })

  it('goes looking for manifests on startup when it is on', async () => {
    harness.config.set('depwatch.manifests', ['**/package.json'])
    harness.found = ['/repo/package.json', '/repo/web/package.json']
    await activate(context())
    await settle()
    expect(harness.log.join('\n')).toContain('2 manifest(s)')
  })
})

describe('the commands it registers', () => {
  beforeEach(async () => {
    await activate(context())
  })

  it('says there is no scan to cancel rather than doing nothing', async () => {
    await run('depwatch.cancel')
    expect(harness.messages.info).toContain('depwatch: no scan is running.')
  })

  it('offers the settings when the gates are asked for but not configured', async () => {
    harness.answers.message = undefined
    await run('depwatch.checkGates')
    expect(harness.messages.info.join('\n')).toContain('no gates configured')
    expect(harness.messages.info.join('\n')).toContain('depwatch check --ci')
  })

  it('says there was no baseline to clear when the file is not there', async () => {
    await run('depwatch.clearBaseline')
    expect(harness.messages.info).toContain('depwatch: there was no baseline to clear.')
  })

  it('deletes the baseline and says every finding is back', async () => {
    harness.files.set('/repo/.depwatch-baseline.json', '{}')
    await run('depwatch.clearBaseline')
    expect(harness.files.has('/repo/.depwatch-baseline.json')).toBe(false)
    expect(harness.messages.info.join('\n')).toContain('baseline cleared')
  })

  it('stores a typed token in the keychain, not in settings', async () => {
    harness.answers.input = 'ghp_typed'
    await run('depwatch.setGitHubToken')
    expect(harness.secrets.get('depwatch.githubToken')).toBe('ghp_typed')
    expect(process.env.GITHUB_TOKEN).toBe('ghp_typed')
  })

  it('clears the token when the box is emptied, and leaves it alone on escape', async () => {
    harness.secrets.set('depwatch.githubToken', 'ghp_old')
    process.env.GITHUB_TOKEN = 'ghp_old'

    harness.answers.input = undefined // escape
    await run('depwatch.setGitHubToken')
    expect(harness.secrets.get('depwatch.githubToken')).toBe('ghp_old')

    harness.answers.input = ''
    await run('depwatch.setGitHubToken')
    expect(harness.secrets.has('depwatch.githubToken')).toBe(false)
    expect(process.env.GITHUB_TOKEN).toBeUndefined()
  })

  it('warns rather than throwing when trend is asked for with nothing open', async () => {
    harness.found = []
    await run('depwatch.showTrend')
    expect(harness.messages.warning.join('\n')).toContain('no dependency manifest found')
  })

  it('shows the log without touching the results', async () => {
    await run('depwatch.showLog')
    expect(harness.log).toContain('<shown>')
  })
})
