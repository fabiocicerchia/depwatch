# depwatch

[![CI](https://github.com/fabiocicerchia/depwatch/actions/workflows/code-quality.yml/badge.svg)](https://github.com/fabiocicerchia/depwatch/actions/workflows/code-quality.yml)
[![Security](https://github.com/fabiocicerchia/depwatch/actions/workflows/security.yml/badge.svg)](https://github.com/fabiocicerchia/depwatch/actions/workflows/security.yml)
[![License](https://img.shields.io/badge/license-Apache_2.0-blue.svg)](LICENSE)
[![OpenSSF Scorecard](https://api.securityscorecards.dev/projects/github.com/fabiocicerchia/depwatch/badge)](https://securityscorecards.dev/viewer/?uri=github.com/fabiocicerchia/depwatch)
[![CI carbon](https://img.shields.io/endpoint?url=https://raw.githubusercontent.com/fabiocicerchia/depwatch/gh-pages/badge.json)](.github/workflows/carbon-badge.yml)

Measures dependencies on two axes and plots them against each other:

- **Drift** — how far behind you are, in *libyears*. Objective and computable.
- **Viability** — can you even catch up? Maintainer activity, bus factor,
  release cadence, archived status, funding signals, last commit.

A dependency 0.2 libyears behind whose sole maintainer vanished is more dangerous
than one 4 libyears behind under active development. Existing tools measure one
axis or the other — **plotting both, the quadrant chart is the product** (and the
screenshot that sells it).

> **Drift is measured; viability is judged.** The libyears figure is arithmetic
> on published release dates and nothing else. The viability score is a
> weighted read of maintainer signals, and every one of them is optional —
> missing signals are dropped and the remaining weights renormalised, so a
> package with only a release history still scores honestly rather than being
> penalised for data that could not be fetched. Gate on drift; treat viability
> as an argument, not a verdict.

![depwatch quadrant chart — drift × viability for depwatch's own package-lock.json](docs/quadrant.svg)

The libyear metric is from Cox, Bouwers, van Eekelen & Visser, "Measuring
Dependency Freshness in Software Systems" (ICSE 2015) — credited prominently.
Prior art to respect, not reinvent: libyear-bundler, libyear-npm,
jdanil/libyear, libyear-maven-plugin, `libyear` on PyPI. jdanil's split of
*drift* (version age) from *pulse* (time since the dep's latest release) is worth
stealing — pulse is the viability axis, nearly free from the same API responses.

## How it works

Two axes, computed independently, then crossed:

```
  depwatch check <manifest>
      │
  resolve input ──────────► a lock beside the manifest wins over the manifest:
      │                      a range gives its floor, so drift read from one is
      │                      an upper bound, not a measurement
      │
  parse ──────────────────► one parser per ecosystem, chosen by filename
      │                      (an SBOM covers every ecosystem at once)
      │
      ▼  per dependency, cached + rate-limited
  registry ───────────────► the version timeline
      │
      ├─ DRIFT ───────────► libyears = release date of latest − release date of
      │                      yours. Undatable at either end scores 0, never a
      │                      guess.
      │
      └─ VIABILITY ───────► cheap tier, free from the same timeline:
                             pulse, release cadence
                            deep tier (--deep), one extra request each:
                             maintainers, archived, last commit, funding
      │
      ▼
  quadrant ───────────────►  viability
                             ▲
                      watch  │  healthy      behind?  → drift > --stale
                    ────────-┼────────►      fading?  → viability < --risky
                     replace │  upgrade      drift
```

`replace` is the quadrant that matters: far behind *and* nobody left to catch
up with. A dependency whose registry could not be reached is marked degraded
and left out of the counts — unknown is not unhealthy.

More in [`docs/architecture.md`](docs/architecture.md).

## Install

```sh
npm install
npm run build       # -> dist/cli.js
```

## Usage

```sh
node dist/cli.js check package.json          # drift + viability table
node dist/cli.js check package.json --json    # machine-readable, for CI
node dist/cli.js chart package.json --out q.svg
```

It reads the manifest and lock files of 15+ ecosystems — npm, Python, Rust, PHP,
Ruby, Go, Java/Maven, .NET, Dart, Elixir, Terraform, Helm, GitHub Actions and
Docker — picking the right parser from the filename:

```sh
node dist/cli.js check go.mod                 # Go modules
node dist/cli.js check pyproject.toml         # Poetry / uv / PEP 621
node dist/cli.js check pom.xml                # Maven Central
node dist/cli.js check .terraform.lock.hcl    # Terraform providers
node dist/cli.js check Dockerfile             # base-image age (pulse only)
```

`depwatch --help` prints the authoritative list — it is generated from the
ecosystem registry, so it cannot drift from the code:

```console
$ depwatch --help
depwatch — dependency drift (libyears) × viability

  depwatch check <manifest> [options]     two-axis table
  depwatch chart <manifest> [options]     quadrant chart (SVG)
  depwatch trend <manifest> [options]     drift over the manifest's git history

Options
  --json                  machine-readable output
  --deep                  fetch maintainer/archived/last-commit signals
                          (extra requests; set GITHUB_TOKEN to avoid throttling)
  --eco <name>            force ecosystem: npm|pep440|cargo|composer|rubygems|pub|hex|nuget|cocoapods|conda|helm|go|maven|terraform|githubactions|docker
  --ci                    exit non-zero when a threshold is breached
  --max-libyears <n>      CI: fail above this total drift
  --max-replace <n>       CI: fail above this many deps in the "replace" quadrant
  --stale <n>             libyears above which a dep counts as behind (default 1)
  --risky <n>             viability below which a dep counts as fading (default 0.5)
  --out <file>            write chart/JSON to a file instead of stdout
  --label-all             chart: label healthy points too
  --no-lock               read the manifest even when a lock file sits beside it
                          (drift then becomes an upper bound, not a measurement)
  --transitive            score the whole dependency tree from the lock file,
                          not just the dependencies you chose
  --max-points <n>        trend: how many commits to sample (default 12)

Inputs, in order of accuracy:
  SBOM         CycloneDX or SPDX JSON — resolved versions, every ecosystem at once
  lock file    package-lock.json, yarn.lock, pnpm-lock.yaml, Cargo.lock,
               composer.lock, Gemfile.lock — resolved versions
  manifest     package.json, requirements.txt, Cargo.toml, composer.json —
               ranges only, so the result is an upper bound
  ...
```

And a real run, against this repo's own manifest:

```console
$ node dist/cli.js check package.json
depwatch: exact versions from package-lock.json (direct dependencies only; --transitive for the full tree)
dep          current  eco  latest  drift  pulse  viability  quadrant
───────────  ───────  ───  ──────  ─────  ─────  ─────────  ────────
vitest       4.1.10        4.1.11  0.12   0.00   1.00       healthy
@types/node  26.2.0        26.2.0  0.00   0.03   1.00       healthy
esbuild      0.28.2        0.28.2  0.00   0.03   1.00       healthy
typescript   7.0.2         7.0.2   0.00   0.11   1.00       healthy

total drift: 0.12 libyears across 4 deps  (npm, package.json + package-lock.json)
quadrants: replace 0  upgrade 0  watch 0  healthy 4
thresholds: behind > 1 libyears, fading < 0.5 viability
```

Exit codes: `0` clean, `1` a `--ci` threshold was breached, `2` the input could
not be read.

## In your editor

The [VS Code extension](extensions/vscode/) puts both axes on the manifest you
are editing: quadrant squiggles with a hover that explains the score, a findings
pane filtered to the current file or the whole project, the CI gates evaluated
live, and the same quadrant report in a tab.

```sh
make ext-install   # build, package a VSIX and install it into VS Code
```

## In CI

The [GitHub Action](docs/github-action.md) in this repository's root measures a
manifest and fails the build on a threshold you set:

```yaml
- uses: fabiocicerchia/depwatch@v0   # pin to a SHA in real workflows
  with:
    manifest: package.json
    max-libyears: 25                 # absolute budget
    max-libyears-increase: 0         # ...or the ratchet: do not make it worse
```

An absolute budget is awkward to adopt on a repository that is already behind —
set it high and it never fires, set it low and every pull request is red for
debt it did not create. The **ratchet** gates from the first day: it measures the
pull request's base branch too and fails only when the pull request adds drift.

It writes a quadrant summary to the job summary, optionally to a sticky pull
request comment, and exposes `libyears`, `delta` and `passed` as step outputs.
depwatch runs it on itself in [`depwatch.yml`](.github/workflows/depwatch.yml).

## Common errors

**`depwatch: unrecognised input: README.md (expected a manifest, a lock file, or a CycloneDX/SPDX SBOM)`** (exit 2)
The ecosystem is chosen by filename. A manifest under a name nobody uses needs
`--eco` to say what it is.

**`depwatch: unsupported ecosystem "nmp" (want one of: npm, pep440, cargo, ...)`** (exit 2)
Refused rather than accepted: without this check a misspelt `--eco` reaches a
lookup that matches nothing and reports an empty dependency list, and "your
manifest is clean" is the worst possible answer to a typo.

**`depwatch: no dependencies found in <file>`** (exit 2)
The file parsed and held nothing depwatch could score — a manifest with only
dev-tool config, or an SBOM whose components all come from registries this tool
cannot query (that case says so explicitly).

**`depwatch: exact versions from package-lock.json`** — not an error.
A note on stderr saying the lock beside your manifest was read instead, because
it carries resolved versions. `--no-lock` reads the manifest anyway, and the
drift figure then becomes an upper bound rather than a measurement.

**Viability comes back 1.00 for everything.**
That is the cheap tier: without `--deep` the only signals available are pulse
and release cadence, and a package that ships regularly scores full marks on
both. `--deep` adds maintainer count, archived status and last commit — and
GitHub rate-limits hard without a `GITHUB_TOKEN` in the environment.

## Documentation

Full docs live in [`docs/`](docs/) — including [the extension's design](docs/vscode.md).
Runnable examples live in [`examples/`](examples/).

## References

- Cox, Bouwers, van Eekelen & Visser, **"Measuring Dependency Freshness in
  Software Systems"**, ICSE 2015 —
  [paper](https://ericbouwers.github.io/papers/icse15.pdf). The metric itself.
- [jdanil/libyear](https://github.com/jdanil/libyear) — the drift/pulse split
  this builds on.
- Prior art in other ecosystems, worth respecting rather than reinventing:
  [libyear-bundler](https://github.com/jaredbeck/libyear-bundler),
  [libyear-npm](https://github.com/jdanil/libyear),
  [libyear-maven-plugin](https://github.com/mfoo/libyear-maven-plugin),
  [`libyear` on PyPI](https://pypi.org/project/libyear/).
- [CycloneDX](https://cyclonedx.org/specification/overview/) and
  [SPDX](https://spdx.github.io/spdx-spec/) — the two SBOM formats read, and
  [purl](https://github.com/package-url/purl-spec) for the component
  identifiers inside them.
- [GitHub REST: repositories](https://docs.github.com/en/rest/repos/repos) —
  the archived and last-commit signals, and the rate limits `--deep` runs into.

## Release cycle

[Semantic Versioning](https://semver.org/), cut by release-please from
[Conventional Commits](https://www.conventionalcommits.org/).

- **Major** — a change to the `--json` shape, the exit codes, or the meaning of
  a quadrant.
- **Minor** — new ecosystems, new signals, new flags. A new viability signal
  can move a package between quadrants, so it arrives with a stated rationale
  and a test.
- **Patch** — fixes; parser corrections included.

The drift maths is not a place for heuristics, and never becomes one: if a
libyear figure ever changes, it is because a parser was reading the wrong
version, not because the metric was tuned.

## Contributing

See [CONTRIBUTING.md](CONTRIBUTING.md). Security issues go through
[GitHub Security Advisories](https://github.com/fabiocicerchia/depwatch/security/advisories/new),
never a public issue — see [SECURITY.md](SECURITY.md).

## License

Licensed under the Apache License, Version 2.0. See [LICENSE](LICENSE).
