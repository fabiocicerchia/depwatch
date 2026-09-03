# Architecture

## Where the two axes come from

**Drift** is the `libyear` engine in `infra-toolbox/src/lib/libyear`, imported
via the `@lib/*` mapping in `tsconfig.json` (esbuild resolves it at bundle time)
— shared, not copied, so the browser tool and the CLI cannot disagree.

**Viability** is scored in `src/viability.ts` from whatever signals are
available, with missing ones dropped and the remaining weights renormalised:

| Tier | Signals | Cost |
| --- | --- | --- |
| default | pulse (time since last release), release cadence | free — already in the version list |
| `--deep` | maintainer count, funding, archived, last commit | one registry + one GitHub request per package |

`--deep` uses `GITHUB_TOKEN` if set; without it GitHub allows 60 requests an
hour, and the enrichment degrades silently to the default tier rather than
failing the run. Archived is terminal: it scores 0 regardless of everything
else. A package that could not be fetched at all scores 0.5 and is reported as
"no data" — unknown is not the same as dead.

The weights are calibrated in `src/viability.test.ts` against synthetic
known-dead and known-alive profiles, so the calibration runs offline and fails
loudly when a weight moves.

## Ecosystems

Every ecosystem is one `EcosystemDef` in `src/ecosystems/`, listed once in
`REGISTRY` (`src/ecosystems/registry.ts`). A def gathers the filenames it
recognises, its manifest/lock parsers, its version fetcher, its `--deep`
metadata extractor and its PURL types. Detection, parsing, SBOM mapping, the
deep tier and the CLI help are all lookups into `REGISTRY` rather than switch
statements scattered across the codebase.

Because `REGISTRY` is typed `Record<EcoId, EcosystemDef>`, a half-added
ecosystem — an `EcoId` member without a def, or a def whose id is missing from
`EcoId` — is a `tsc` error. `make typecheck` runs in CI for exactly this reason.
Adding an ecosystem is one file plus one test.

Ecosystems fall into three tiers by how they date versions:

| Tier | How dates arrive | Examples |
| --- | --- | --- |
| dated list | one request returns every version with its date | npm, PyPI, crates.io, pub.dev, Hex, NuGet |
| undated list + `hydrateDates` | versions are listed cheaply, then only the *scored* versions (current, latest, the cadence window — a handful) are dated with one request each | Go, Maven, Terraform, GitHub Actions |
| pulse only (`driftScorable: false`) | honest dates but no orderable version series, so drift is `—` and only pulse and viability are scored | Docker |

`hydrateDates` requests go through the same in-process cache and concurrency
pool as the version fetches, so the "no uncached fetch" rule holds and trend
mode still costs no extra traffic per commit. One ecosystem is `scoped` (Helm):
a chart's identity is its repository URL plus its name, and one `index.yaml`
fetch is cached per repository to serve every chart from it.

## Trend mode

Release dates are historical facts, so every past point is computable from
today's registry data: `depwatch trend` walks the manifest's `git log`, samples
evenly, and scores each revision as of that commit's date. Registry responses are
cached in-process, so the extra commits cost no extra requests.

## Surfaces

The CLI is not the only caller. `extensions/vscode/` runs the same engine
in-process — esbuild bundles `src/` into the extension, so there is no
subprocess and no parsed stdout — which is why the decisions both surfaces have
to agree on live in modules rather than in `cli.ts`:

- `src/input.ts` — which file gets read (the lock beside the manifest), which
  dependencies count, and the notes explaining both.
- `src/gates.ts` — `--max-libyears` and `--max-replace`, evaluated once.
- `src/round.ts` — the two decimals every surface reports. The ratchet compares
  a stored total against a freshly computed one, so a second copy of this
  rounding is a wrong verdict rather than a style question.
- `AnalyseOptions.cache` — where fetched data is remembered. The CLI defaults to
  a process-lifetime map; the extension hands in a TTL cache on disk.

What the CLI does *not* share sits beside it. `src/render-text.ts` holds the
padded monospace table and the trend listing, because the report's shape
(`REPORT_COLUMNS` in `src/report.ts`) and the report's appearance change for
different reasons — the extension renders the same columns into a `<table>`.
`src/flags.ts` holds the option tables, the `Flags` shape and `parseFlags`, so
`cli.ts` is the commands and the help text; an option is added in one place and
nothing that runs a command has to move.

## Inside the editors

Both extensions are wiring plus one-job modules, for the same reason `cli.ts`
is: activation, what a command does, and what a finding says change for
different reasons.

`extensions/vscode/src/` — `extension.ts` is activation and the scan policy
(what triggers a scan, and the watchers and settings listener that decide);
`scan-runner.ts` is one run of it, with its progress and its abort controller;
`commands.ts` registers every id in `package.json`'s `contributes.commands`
behind an explicit dependency bag; `baseline-file.ts` is the committed baseline.
The pane, the squiggles, the status bar and the report panel each already had
their own file.

`extensions/nvim/lua/depwatch/` — `init.lua` is `setup()`, the session (its
configuration and what the last scan found) and the scan policy, and it hands
that session to the rest as an explicit context: `commands.lua` (the
`:Depwatch*` commands), `triggers.lua` (the autocommands and the refresh timer),
`quickfix.lua`, `discover.lua` (which files are worth scanning) and `cli.lua`
(the subprocess). `core.lua` is the ported logic — the command line, the
ordering, the grouping, the totals and the gates — and re-exports `explain.lua`
(what a finding says) and `locate.lua` (where it is written), because `core` is
the name the rest of the plugin already asks for.

Both are covered without an editor: the Lua specs run under plenary-busted
(`make -C extensions/nvim test`), and `activate()` is exercised against a small
`vscode` module in `extensions/vscode/src/testing/vscode.ts`, aliased in by
`vitest.config.ts`. esbuild still marks the real `vscode` external, so the
shipped bundle is unaffected.

See [VS Code extension](vscode.md).
