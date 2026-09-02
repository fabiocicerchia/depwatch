// The `vscode` module, for the test runner.
//
// The extension host is the one dependency a unit test cannot have: `vscode` is
// injected at runtime and resolves to nothing on disk, so importing
// extension.ts outside the editor fails at the first line. Everything below
// activation was therefore untestable — which is exactly the code that decides
// which commands exist and what they do.
//
// This is that module, small enough to read in one sitting. It is not a
// simulation of VS Code: it records what the extension asked for (commands,
// watchers, messages, files) and answers with what `harness` was told to
// answer, so a test can assert on the extension's side of the contract. The
// vitest alias in the repo's vitest.config.ts points `vscode` here; esbuild
// still marks the real thing external, so nothing about the shipped bundle
// changes.

export type Listener<T> = (e: T) => unknown

export interface Disposable {
  dispose(): unknown
}

export class EventEmitter<T> {
  private listeners: Listener<T>[] = []

  readonly event = (listener: Listener<T>): Disposable => {
    this.listeners.push(listener)
    return {
      dispose: () => {
        this.listeners = this.listeners.filter((l) => l !== listener)
      },
    }
  }

  fire(e: T): void {
    for (const listener of [...this.listeners]) listener(e)
  }

  dispose(): void {
    this.listeners = []
  }
}

export class Uri {
  private constructor(
    readonly scheme: string,
    readonly path: string,
  ) {}

  static file(path: string): Uri {
    return new Uri('file', path)
  }

  static parse(value: string): Uri {
    const at = value.indexOf(':')
    return at === -1 ? new Uri('file', value) : new Uri(value.slice(0, at), value.slice(at + 1).replace(/^\/\//, ''))
  }

  static joinPath(base: Uri, ...parts: string[]): Uri {
    return new Uri(base.scheme, [base.path.replace(/\/$/, ''), ...parts].join('/'))
  }

  get fsPath(): string {
    return this.path
  }

  toString(): string {
    return `${this.scheme}://${this.path}`
  }
}

export class Position {
  constructor(
    readonly line: number,
    readonly character: number,
  ) {}
}

export class Range {
  constructor(
    readonly start: Position,
    readonly end: Position,
  ) {}
}

export class Selection extends Range {}

export class ThemeIcon {
  constructor(
    readonly id: string,
    readonly color?: ThemeColor,
  ) {}
}

export class ThemeColor {
  constructor(readonly id: string) {}
}

export class MarkdownString {
  isTrusted = false
  supportHtml = false
  constructor(public value = '') {}
  appendMarkdown(text: string): this {
    this.value += text
    return this
  }
}

export class TreeItem {
  id?: string
  description?: string | boolean
  tooltip?: string | MarkdownString
  iconPath?: ThemeIcon
  command?: unknown
  contextValue?: string
  constructor(
    public label: string,
    public collapsibleState?: number,
  ) {}
}

export class Diagnostic {
  source?: string
  code?: string
  constructor(
    readonly range: Range,
    readonly message: string,
    readonly severity?: number,
  ) {}
}

export class Hover {
  constructor(readonly contents: unknown) {}
}

export const DiagnosticSeverity = { Error: 0, Warning: 1, Information: 2, Hint: 3 } as const
export const FileType = { Unknown: 0, File: 1, Directory: 2, SymbolicLink: 64 } as const
export const ProgressLocation = { SourceControl: 1, Window: 10, Notification: 15 } as const
export const StatusBarAlignment = { Left: 1, Right: 2 } as const
export const TreeItemCollapsibleState = { None: 0, Collapsed: 1, Expanded: 2 } as const
export const ViewColumn = { Active: -1, Beside: -2, One: 1 } as const
export const TextEditorRevealType = { Default: 0, InCenter: 1, InCenterIfOutsideViewport: 2 } as const

// --- what the test drives ---

export interface FakeWatcher {
  glob: string
  change: EventEmitter<Uri>
  create: EventEmitter<Uri>
  delete: EventEmitter<Uri>
}

export interface Harness {
  /** Settings, by full key: `depwatch.enable`, `files.exclude`, … */
  config: Map<string, unknown>
  /** Command id -> handler, in registration order. */
  commands: Map<string, (...args: unknown[]) => unknown>
  /** Every file-system watcher activate() asked for. */
  watchers: FakeWatcher[]
  /** Tree views, by id. */
  views: Map<string, Record<string, unknown>>
  /** The in-memory workspace file system. */
  files: Map<string, string>
  /** Absolute paths `findFiles` will answer with. */
  found: string[]
  workspaceFolders: { uri: Uri; name: string; index: number }[] | undefined
  activeDocument: { uri: Uri; version: number; text: string } | undefined
  /** What the extension said, by kind. */
  messages: { info: string[]; warning: string[] }
  /** Replies to the modal-ish prompts, consumed in order. */
  answers: { message?: string; quickPick?: unknown; input?: string; save?: Uri }
  terminals: { name: string; sent: string[] }[]
  secrets: Map<string, string>
  log: string[]
  reset(): void
}

const emptyHarness = (): Omit<Harness, 'reset'> => ({
  config: new Map(),
  commands: new Map(),
  watchers: [],
  views: new Map(),
  files: new Map(),
  found: [],
  workspaceFolders: [{ uri: Uri.file('/repo'), name: 'repo', index: 0 }],
  activeDocument: undefined,
  messages: { info: [], warning: [] },
  answers: {},
  terminals: [],
  secrets: new Map(),
  log: [],
})

export const harness: Harness = {
  ...emptyHarness(),
  reset(): void {
    Object.assign(harness, emptyHarness())
  },
}

const settingOf = <T>(key: string, fallback: T): T => (harness.config.has(key) ? (harness.config.get(key) as T) : fallback)

// --- the module surface the extension uses ---

export const workspace = {
  get workspaceFolders() {
    return harness.workspaceFolders
  },

  get textDocuments() {
    return harness.activeDocument ? [document(harness.activeDocument)] : []
  },

  getConfiguration(section?: string, _scope?: Uri) {
    const prefix = section ? `${section}.` : ''
    return {
      get: <T>(key: string, fallback?: T): T | undefined => settingOf(`${prefix}${key}`, fallback) as T | undefined,
    }
  },

  getWorkspaceFolder(uri: Uri) {
    return harness.workspaceFolders?.find((f) => uri.fsPath.startsWith(f.uri.fsPath))
  },

  asRelativePath(path: string): string {
    const root = harness.workspaceFolders?.[0]?.uri.fsPath
    return root && path.startsWith(`${root}/`) ? path.slice(root.length + 1) : path
  },

  async findFiles(_include: string, _exclude?: string, _max?: number): Promise<Uri[]> {
    return harness.found.map(Uri.file)
  },

  createFileSystemWatcher(glob: string) {
    const watcher: FakeWatcher = {
      glob,
      change: new EventEmitter<Uri>(),
      create: new EventEmitter<Uri>(),
      delete: new EventEmitter<Uri>(),
    }
    harness.watchers.push(watcher)
    return {
      ...watcher,
      onDidChange: watcher.change.event,
      onDidCreate: watcher.create.event,
      onDidDelete: watcher.delete.event,
      dispose: () => undefined,
    }
  },

  async openTextDocument(uri: Uri) {
    return document({ uri, version: 1, text: harness.files.get(uri.fsPath) ?? '' })
  },

  onDidSaveTextDocument: new EventEmitter<{ uri: Uri }>().event,
  onDidOpenTextDocument: new EventEmitter<{ uri: Uri }>().event,
  onDidChangeTextDocument: new EventEmitter<{ document: { uri: Uri } }>().event,
  onDidChangeConfiguration: new EventEmitter<{ affectsConfiguration: (k: string) => boolean }>().event,

  fs: {
    async readFile(uri: Uri): Promise<Uint8Array> {
      const text = harness.files.get(uri.fsPath)
      if (text === undefined) throw new Error(`ENOENT: ${uri.fsPath}`)
      return new TextEncoder().encode(text)
    },
    async writeFile(uri: Uri, data: Uint8Array): Promise<void> {
      harness.files.set(uri.fsPath, new TextDecoder().decode(data))
    },
    async delete(uri: Uri): Promise<void> {
      if (!harness.files.delete(uri.fsPath)) throw new Error(`ENOENT: ${uri.fsPath}`)
    },
    async stat(uri: Uri): Promise<{ mtime: number; size: number }> {
      const text = harness.files.get(uri.fsPath)
      if (text === undefined) throw new Error(`ENOENT: ${uri.fsPath}`)
      return { mtime: 1, size: text.length }
    },
    async createDirectory(_uri: Uri): Promise<void> {},
    async readDirectory(_uri: Uri): Promise<[string, number][]> {
      return []
    },
  },
}

const document = (d: { uri: Uri; version: number; text: string }) => ({
  uri: d.uri,
  version: d.version,
  getText: () => d.text,
  positionAt: (offset: number) => new Position(0, offset),
})

export const window = {
  get activeTextEditor() {
    return harness.activeDocument ? { document: document(harness.activeDocument) } : undefined
  },

  state: { focused: true },
  onDidChangeWindowState: new EventEmitter<{ focused: boolean }>().event,
  onDidChangeActiveTextEditor: new EventEmitter<unknown>().event,

  createOutputChannel(_name: string, _opts?: unknown) {
    return {
      debug: (line: string) => harness.log.push(line),
      info: (line: string) => harness.log.push(line),
      show: () => harness.log.push('<shown>'),
      dispose: () => undefined,
    }
  },

  createTreeView(id: string, options: Record<string, unknown>) {
    const view = { id, options, description: undefined, badge: undefined, reveal: async () => undefined, dispose: () => undefined }
    harness.views.set(id, view)
    return view
  },

  createStatusBarItem(_alignment?: number, _priority?: number) {
    return {
      text: '',
      tooltip: undefined as unknown,
      command: undefined as unknown,
      backgroundColor: undefined as unknown,
      show: () => undefined,
      hide: () => undefined,
      dispose: () => undefined,
    }
  },

  createWebviewPanel(_id: string, _title: string, _column: number, _opts?: unknown) {
    return {
      webview: { html: '', cspSource: '', onDidReceiveMessage: new EventEmitter<unknown>().event, postMessage: async () => true },
      onDidDispose: new EventEmitter<void>().event,
      onDidChangeViewState: new EventEmitter<void>().event,
      reveal: () => undefined,
      dispose: () => undefined,
      visible: true,
    }
  },

  createTerminal(name: string) {
    const terminal = { name, sent: [] as string[] }
    harness.terminals.push(terminal)
    return { show: () => undefined, sendText: (text: string) => terminal.sent.push(text) }
  },

  async showInformationMessage(message: string, ..._items: string[]): Promise<string | undefined> {
    harness.messages.info.push(message)
    return harness.answers.message
  },

  async showWarningMessage(message: string, ..._items: string[]): Promise<string | undefined> {
    harness.messages.warning.push(message)
    return harness.answers.message
  },

  async showQuickPick(items: unknown, _opts?: unknown): Promise<unknown> {
    return harness.answers.quickPick ?? (await items)
  },

  async showInputBox(_opts?: unknown): Promise<string | undefined> {
    return harness.answers.input
  },

  async showSaveDialog(_opts?: unknown): Promise<Uri | undefined> {
    return harness.answers.save
  },

  async showTextDocument(_doc: unknown, _opts?: unknown) {
    return { selection: undefined as unknown, revealRange: () => undefined }
  },

  async withProgress<T>(_options: unknown, task: (progress: unknown, token: unknown) => Thenable<T>): Promise<T> {
    return task({ report: () => undefined }, { onCancellationRequested: () => ({ dispose: () => undefined }) })
  },
}

export const commands = {
  registerCommand(name: string, run: (...args: unknown[]) => unknown): Disposable {
    harness.commands.set(name, run)
    return { dispose: () => harness.commands.delete(name) }
  },

  async executeCommand(name: string, ...args: unknown[]): Promise<unknown> {
    return harness.commands.get(name)?.(...args)
  },
}

export const languages = {
  createDiagnosticCollection(_name: string) {
    return { set: () => undefined, delete: () => undefined, clear: () => undefined, dispose: () => undefined }
  },
  registerHoverProvider(_selector: unknown, _provider: unknown): Disposable {
    return { dispose: () => undefined }
  },
}

export const env = {
  async openExternal(_uri: Uri): Promise<boolean> {
    return true
  },
}
