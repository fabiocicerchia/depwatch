// The disk half of the cache, under the extension's global storage — so a
// second window, or tomorrow's session, starts warm instead of re-fetching
// every package in the workspace.

import * as vscode from 'vscode'
import type { CacheStore } from './cache.js'

export class FileCacheStore implements CacheStore {
  private ready: Thenable<unknown> | null = null

  constructor(private readonly dir: vscode.Uri) {}

  async read(id: string): Promise<string | undefined> {
    try {
      return new TextDecoder().decode(await vscode.workspace.fs.readFile(this.uri(id)))
    } catch {
      return undefined // a miss and an unreadable file are the same thing here
    }
  }

  async write(id: string, data: string): Promise<void> {
    this.ready ??= vscode.workspace.fs.createDirectory(this.dir)
    await this.ready
    await vscode.workspace.fs.writeFile(this.uri(id), new TextEncoder().encode(data))
  }

  async remove(id: string): Promise<void> {
    try {
      await vscode.workspace.fs.delete(this.uri(id))
    } catch {
      // Already gone: the outcome we wanted.
    }
  }

  async entries(): Promise<{ id: string; mtime: number }[]> {
    let listing: [string, vscode.FileType][]
    try {
      listing = await vscode.workspace.fs.readDirectory(this.dir)
    } catch {
      return []
    }
    const files = listing.filter(([, type]) => type === vscode.FileType.File)
    return Promise.all(
      files.map(async ([name]) => {
        try {
          const stat = await vscode.workspace.fs.stat(this.uri(name))
          return { id: name, mtime: stat.mtime }
        } catch {
          return { id: name, mtime: 0 } // unreadable: treat as ancient, let it be pruned
        }
      }),
    )
  }

  private uri(id: string): vscode.Uri {
    return vscode.Uri.joinPath(this.dir, `${id}.json`)
  }
}
