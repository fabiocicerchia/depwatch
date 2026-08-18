# VS Code extension

`extensions/vscode/` is depwatch in the editor: the same two axes, measured by
the same engine, on the manifest you are actually editing.

```sh
make ext-install     # build, package a VSIX, install it into VS Code
```

Or press <kbd>F5</kbd> with `extensions/vscode` open to try it in an Extension
Development Host without installing anything. The extension's own README
documents every command and setting; this page is about how it is built and why.

`ext-install` chains `ext-build` (install, typecheck, bundle) and `ext-package`
(`vsce`). Two files exist only so that chain runs unattended:
`extensions/vscode/LICENSE.md`, because vsce stops to ask whether you really
mean to ship without a licence and offers no flag to answer in advance; and
`media/icon.png`, because the Extensions list wants a PNG and the panel
container's `quadrant.svg` is not eligible. A third, `CHANGELOG.md`, is copied
in from the repo root at package time and gitignored — the Marketplace renders
one as a tab, and a second changelog beside the generated one would only ever be
out of date.

## Releasing

The extension has no version of its own. `release-please-config.json` lists
`extensions/vscode/package.json` (and its lock) as extra files, so the release
PR that bumps `version.txt` bumps the extension in the same commit, and the tag
means one thing for both surfaces.

Merging that PR tags the release, and `release.yml` calls
`publish-extension.yml` in the same run: version from the tag, `npm ci`,
`npm run package` (typecheck, tests, bundle, legal files, `vsce package`), then
publish to the VS Marketplace and to Open VSX, attach the `.vsix` to the
release. Calling it rather than hanging it off `on: release` is deliberate: the
release release-please publishes carries GITHUB_TOKEN, and GitHub does not start
workflows from GITHUB_TOKEN events. It re-stamps the version from the tag before packaging — normally a
no-op, but `workflow_dispatch` takes a version too, and a manifest that
disagrees with the tag must never ship.

The workflow is inert until the tokens exist. Each publish step is skipped when
its secret is missing, and the job summary says which registries were skipped
and why, so a run without secrets is a package-and-attach rather than a failure.

Two one-time setup steps only the repository owner can do:

| | VS Marketplace | Open VSX |
| --- | --- | --- |
| Account | [Azure DevOps](https://dev.azure.com) organisation | GitHub, via [open-vsx.org](https://open-vsx.org) |
| Namespace | publisher `fabiocicerchia`, created at [marketplace.visualstudio.com/manage](https://marketplace.visualstudio.com/manage) | namespace `fabiocicerchia`, `ovsx create-namespace` |
| Token | PAT scoped **All accessible organizations** + **Marketplace → Manage** | access token from the Open VSX profile page |
| Secret | `VSCE_PAT` | `OVSX_PAT` |

The PAT's organisation scope is the one that catches people out: a PAT limited
to a single Azure DevOps organisation authenticates and then fails to publish.

`make ext-publish` does the same thing from a laptop when CI is not an option.
It needs the same two environment variables and it publishes whatever is in the
working tree, which is why it is the escape hatch rather than the route.

Marketplace versions are immutable — a version can be superseded, never
replaced — so the workflow rejects anything that is not `x.y.z` before it starts
rather than half way through.

## The engine is imported, not shelled out to

esbuild bundles `src/extension.ts` **and** depwatch's `src/` into one
`dist/extension.js`, resolving `@lib/*` through the same tsconfig paths the CLI
build uses. There is no `node dist/cli.js` subprocess and no stdout to parse:
the extension calls `loadManifest()` and `analyse()` and gets typed reports.

That is what makes "the extension and the CLI cannot disagree" true rather than
aspirational, and it is why three pieces of the CLI moved into modules of their
own when the extension was written:

| Module | Was | Why it moved |
| --- | --- | --- |
| `src/input.ts` | inline in `cli.ts` | which file is read, which deps count, and what the user is told about both — needed identically by both surfaces |
| `src/gates.ts` | inline in `cli.ts` | a gate that says "fail" in CI and "fine" in the editor is worse than no gate |
| `AnalyseOptions.cache` | a module-level `Map` | a long-lived host needs a cache that survives restarts |

`DepReport` also carries its `signals` now. The score was always computed from
them; the editor is the first surface that has to answer "why 0.31?" in a
tooltip.

## Scanning policy

Registries are the expensive part, so the extension is built to ask rarely:

- on startup, on save (debounced), on a six-hour timer, or on request;
- **never** while typing;
- the timer is skipped while the window is unfocused, and the missed tick runs
  once when focus returns.

Four layers absorb the rest, in the order they get a chance to:

0. **The file stamps** — mtime and size, or the open document's version. The
   parse is reused when nothing moved: ~10ms of blocking `JSON.parse` on a 1 MB
   lock versus 0.004ms for two stats. The save path calls `Scanner.forget()`
   first, so an edit always re-reads regardless of what the timestamps say.
1. **The dependency signature** — the sorted `name@version` list, the deep flag
   and the thresholds. Unchanged means the previous report is returned and
   nothing else runs. Editing a `scripts` block costs one parse.
2. **The TTL cache** (`extensions/vscode/src/cache.ts`) — memory in front of
   disk, in the extension's global storage. Version lists keep for 12 hours,
   deep metadata for 72, failures for ten minutes in memory only. A stale entry
   is served when a refetch fails, so offline degrades to the last known answer
   rather than to nothing. Writes are queued one at a time; entries past twice
   their TTL, and anything beyond the cap, are pruned once per session.
3. **Concurrency** — six in flight, one manifest at a time.

Memory is bounded rather than left to grow: the cache's memory layer is an LRU
capped at `depwatch.cache.maxInMemory`, because a parsed version list for a busy
package is ~130 KB and a monorepo has hundreds of them. Eviction costs a disk
read, not a request. `Results` announces changes once per 150ms burst and says
which paths moved, so a workspace scan is one tree rebuild and one diagnostic
publish per manifest rather than N of each.

Deep metadata is cacheable at all only because `fetchDeepMeta()` returns what
was fetched (`archived`, `lastCommitAt`) rather than what was derived from it
("days since"). Ages are computed at merge time against `now`, which is also
what lets trend mode score the same package at a dozen different instants.

## What gets scanned

`workspace.findFiles(include, exclude)` applies `files.exclude` only when
`exclude` is `undefined`, and never applies `search.exclude`. An extension that
passes its own exclude therefore replaces the user's rather than adding to it —
so `config.ts` reads both settings and merges them with `depwatch.exclude` into
one brace group.

File events do not go through `findFiles` at all, so `exclude.ts` also pulls the
directory names out of those globs for a segment check. Only directories: a
`**/package-lock.json` in someone's `search.exclude` means "keep it out of search
results", not "stop measuring this project", and reading it as an exclusion
would quietly stop the rescans that matter most.

## Baselines

`baseline.ts` is pure: serialise the findings, read them back, and answer which
of today's dependencies the file already accounts for. A dependency is worse —
and so comes back — when it has drifted further than was accepted, or when it
has fallen to a worse quadrant at the same drift. The second case is the one
that justifies a depwatch-specific baseline rather than a version ignore-list:
it is how "the maintainer walked away since you signed off" surfaces.

The filter is applied in `extension.ts`, not in the scanner, so the cache keeps
full reports and writing a baseline re-filters what is already in hand instead
of costing a rescan.

## Where a finding is drawn

The engine reports names; `locate.ts` finds where each name is written, one
index per file shape (package.json sections, lock-file keys, Cargo tables,
requirements lines, and a quoted-string fallback for SBOMs). Names the index
does not find are simply not underlined — a squiggle on the wrong line is worse
than no squiggle.

## The report

`html.ts` renders one layout with two palettes. In the webview every colour and
font is a `--vscode-*` theme token, so the report is the editor's own light,
dark and high-contrast themes. Exported to a file there is no theme to inherit,
so it uses the palette from `docs/index.html`, and no script at all.

The quadrant chart in both is `quadrantSVG()` — the same picture the CLI writes.
