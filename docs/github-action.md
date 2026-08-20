# GitHub Action

depwatch ships as a composite action in the root of this repository, so a
workflow can measure drift and viability and fail on a threshold without
installing anything.

```yaml
- uses: fabiocicerchia/depwatch@v0  # pin to a SHA in real workflows
  with:
    manifest: package.json
    max-libyears: 25
```

The action builds the CLI from the checkout GitHub already makes of this
repository at the ref you pinned — what runs is exactly the code at that ref,
which is the reason pinning a SHA is worth doing.

## Two shapes of threshold

`max-libyears` is an absolute budget: fail above this many libyears in total.
It is the right gate once you have a number you are willing to defend, and the
wrong one before that. On a repository already well behind, a budget set above
today's figure never fires, and one set below it fails every pull request for
debt that pull request did not create.

`max-libyears-increase` is a **ratchet**, and it gates from the first day:
whatever the total is, a pull request may not add more than this to it. `0`
means "must not grow at all".

```yaml
- uses: fabiocicerchia/depwatch@v0
  with:
    max-libyears-increase: 0        # do not make it worse
```

The ratchet measures the pull request's base branch the same way and compares
the two totals. That is a second pass over the registries, so it only runs when
you ask for it. Off a pull request there is nothing to compare against, and it
reports itself skipped rather than failing.

Both are ceilings that may be reached: `max-libyears: 10` passes at exactly
10.00 and fails above it. Totals are compared at the two decimals depwatch
reports everywhere, so a ratchet of `0` is not tripped by floating-point dust.

`max-replace` is the viability axis's gate: fail above this many dependencies in
the *replace* quadrant — far behind **and** fading. `max-replace: 0` is a
strong, and defensible, default.

Every gate is evaluated by [`src/gates.ts`](https://github.com/fabiocicerchia/depwatch/blob/main/src/gates.ts),
the same code behind `depwatch check --ci` and the VS Code extension. A gate
that said "fail" in CI and "fine" in the editor would be worse than no gate.

## Adopting a gate

Measure before you gate. `fail-on-threshold: false` publishes the number, the
job summary and the outputs while reporting a breach as a warning rather than a
failure — run it for a fortnight, then set a budget you can defend and flip it
back.

```yaml
- uses: fabiocicerchia/depwatch@v0
  with:
    max-libyears: 25
    fail-on-threshold: false
```

## Inputs

| Input | Default | Description |
| --- | --- | --- |
| `manifest` | `package.json` | Manifest, lock file or SBOM to measure. A lock file beside the manifest is preferred automatically. |
| `max-libyears` | — | Fail above this total drift. |
| `max-libyears-increase` | — | Fail when drift grew more than this against `base-ref`. |
| `max-replace` | — | Fail above this many dependencies in the *replace* quadrant. |
| `base-ref` | the pull request's base branch | What the ratchet compares against. |
| `fail-on-threshold` | `true` | Whether a breach fails the step or only warns. |
| `stale` | `1` | Libyears above which a dependency counts as behind. |
| `risky` | `0.5` | Viability below which a dependency counts as fading. |
| `deep` | `false` | Fetch maintainer, archived and last-commit signals. |
| `transitive` | `false` | Score the whole tree from the lock file, not just direct dependencies. |
| `no-lock` | `false` | Read the manifest even when a lock file sits beside it. |
| `eco` | inferred | Force the ecosystem instead of inferring it from the filename. |
| `json` | under `RUNNER_TEMP` | Where to write the full JSON report. |
| `chart` | — | Where to write the quadrant SVG. Costs a second pass over the registries. |
| `summary` | `true` | Write the report to the job summary. |
| `comment` | `false` | Post the report on the pull request, updating one comment rather than adding one per push. |
| `artifact` | — | Name of an artifact to upload the report (and chart) to. |
| `artifact-retention-days` | repository default | How long to keep that artifact. |
| `node-version` | `22` | Node used to build and run depwatch. |
| `github-token` | `github.token` | Token for the API signals under `deep`, and for `comment`. |
| `working-directory` | `.` | Directory to resolve `manifest` against. |

## Outputs

| Output | Description |
| --- | --- |
| `libyears` | Total drift, to two decimals. |
| `baseline-libyears` | Total drift of `base-ref`, or empty when the ratchet did not run. |
| `delta` | Signed change against `base-ref`, e.g. `+0.42`. Empty when the ratchet did not run. |
| `deps` | Number of dependencies measured. |
| `ecosystem` / `file` | What was read, and how it was read. |
| `replace` / `upgrade` / `watch` / `healthy` | Quadrant counts. |
| `degraded` | Dependencies the registry would not answer for, and which were not scored. |
| `passed` | `true` when no threshold was breached — readable even under `fail-on-threshold: false`. |
| `report` | Path to the JSON report. |

`passed` is how you gate something other than the build:

```yaml
- id: depwatch
  uses: fabiocicerchia/depwatch@v0
  with:
    max-libyears-increase: 0
    fail-on-threshold: false
- if: steps.depwatch.outputs.passed == 'false'
  run: echo "drift grew by ${{ steps.depwatch.outputs.delta }} libyears"
```

## Permissions

`contents: read` is enough. `comment: true` also needs
`pull-requests: write` — without it the comment is skipped with a warning rather
than failing a build whose gates passed.

```yaml
permissions:
  contents: read
  pull-requests: write
```

## Exit codes

A breached threshold fails the step; a manifest that cannot be read or parsed
fails it too, and is reported distinctly. `fail-on-threshold: false` softens
the first and deliberately does **not** soften the second — a broken invocation
that reports "no drift" is the one outcome worse than a red build.

## Measuring something other than npm

`manifest` takes anything the CLI takes — a lock file, or an SBOM covering a
polyglot repository in one file.

```yaml
- uses: fabiocicerchia/depwatch@v0
  with:
    manifest: bom.json          # CycloneDX or SPDX, every ecosystem at once
    max-libyears-increase: 0
```

See [Getting Started](getting-started.md) for the full list, and for why an SBOM
or a lock file measures drift where a manifest can only bound it.
