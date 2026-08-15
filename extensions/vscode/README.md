# depwatch for VS Code

Dependency drift (libyears) × viability, in the editor. Same engine as the CLI,
same numbers, same quadrant.

- **Squiggles on the manifest.** Each dependency is underlined with its
  quadrant, and the hover says why: how far behind, when the last release was,
  how many maintainers, whether the repository is archived.
- **A findings pane**, in the bottom panel. Grouped by quadrant, worst first,
  filtered to the manifest the current file belongs to or the whole project.
- **The report**, as a tab: the totals, the quadrant chart and the table
  `depwatch check` prints. Click a row to jump to that dependency.
- **The gates** from `depwatch check --ci` — `--max-libyears`, `--max-replace` —
  evaluated live, so the budget that fails the build fails in the editor first.
- **Trend**, from the manifest's own git history.
- **Deep scan**, on demand: maintainer count, funding, archived status and last
  commit.

Everything except the report is native VS Code UI: the tree view, the Problems
panel, hovers, the status bar. The report is a webview, themed entirely from
your colour theme.

## Install

```sh
cd extensions/vscode
npm install
npm run build
```

Then either press <kbd>F5</kbd> in VS Code with this folder open (Extension
Development Host), or package it:

```sh
npx @vscode/vsce package --no-dependencies   # -> depwatch-vscode-0.1.0.vsix
code --install-extension depwatch-vscode-0.1.0.vsix
```

## Commands

| Command | What it does |
| --- | --- |
| `depwatch: Scan the workspace` | Every manifest, up to `depwatch.maxManifests` |
| `depwatch: Scan the active manifest` | Just this one, ignoring the cached result |
| `depwatch: Deep scan` | Adds maintainers, funding, archived, last commit |
| `depwatch: Open the report` | The quadrant chart and the table, in a tab |
| `depwatch: Show drift over git history` | Trend, sampled from `git log` |
| `depwatch: Check the CI gates` | The same verdict `--ci` gives |
| `depwatch: Export the report as HTML` | A standalone file, for a browser or a PR |
| `depwatch: Export the quadrant chart as SVG` | The chart on its own |
| `depwatch: Clear the registry cache` | Forces the next scan to refetch |
| `depwatch: Set the GitHub token` | Stored in the OS keychain, for deep scans |

## When it scans, and what it costs

Scanning means asking five public registries about every dependency you have,
so the extension is built to do it rarely and remember the answers:

| Trigger | Default |
| --- | --- |
| Workspace opens | on — usually served entirely from the cache |
| Manifest or lock file saved | on, debounced 1.5s |
| While typing | **never** |
| Periodic re-check | every 6h, and only while the window has focus |

Three things keep the cost down, in the order they get a chance to:

1. **The dependency signature.** If the deps and their versions are unchanged
   since the last scan, the previous report is reused and nothing runs. Editing
   the `scripts` block of a `package.json` costs one parse.
2. **The TTL cache** — memory in front of disk, under the extension's global
   storage. A published release is a historical fact, so a version list is good
   for 12 hours (`depwatch.cache.registryTtlHours`) and deep metadata for 72.
   A second window, or tomorrow's session, starts warm. Failures are cached for
   ten minutes in memory only, so a package that 404s is asked about once rather
   than once per dependency. When a refetch fails, the stale entry is served —
   offline degrades to yesterday's report, not to a blank one.
3. **Concurrency limiting**: six requests in flight (`depwatch.concurrency`),
   one manifest at a time.

If you want it quieter still: set `depwatch.scan.refreshMinutes` to `0` to turn
the timer off entirely, and `depwatch.scan.onSave` to `false` to make scanning
fully manual. If you want it sharper, lower `registryTtlHours`.

The `--deep` tier is off by default because it is two extra requests per package
and GitHub rate-limits hard without a token. Run `depwatch: Set the GitHub
token` once, then use the deep scan command when you want the full picture.

## Settings

All under `depwatch.` — see the Settings UI for the full list, which covers
discovery globs (`manifests`, `exclude`, `maxManifests`), the analysis
(`deep`, `transitive`, `useLockFile`, `concurrency`), the thresholds that draw
the quadrants (`thresholds.staleLibyears`, `thresholds.riskyViability`), the
gates (`gates.maxLibyears`, `gates.maxReplace`), scheduling (`scan.*`), caching
(`cache.*`) and per-quadrant diagnostic severity (`diagnostics.*`).

Severity defaults: `replace` warns, `upgrade` and `watch` inform, `healthy` and
unscorable dependencies say nothing.

## Behind a proxy

Registry requests go through Node's global `fetch` in the extension host. If
your network needs a proxy, set `http_proxy` / `https_proxy` in the environment
VS Code is launched from; the `http.proxySupport` setting does not cover
`fetch`.

## Licence

Apache 2.0, same as depwatch.
