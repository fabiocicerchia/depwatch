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
- `AnalyseOptions.cache` — where fetched data is remembered. The CLI defaults to
  a process-lifetime map; the extension hands in a TTL cache on disk.

See [VS Code extension](vscode.md).
