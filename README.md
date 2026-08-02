# depwatch

[![CI](https://github.com/fabiocicerchia/depwatch/actions/workflows/code-quality.yml/badge.svg)](https://github.com/fabiocicerchia/depwatch/actions/workflows/code-quality.yml)
[![Security](https://github.com/fabiocicerchia/depwatch/actions/workflows/security.yml/badge.svg)](https://github.com/fabiocicerchia/depwatch/actions/workflows/security.yml)
[![License](https://img.shields.io/badge/license-Apache_2.0-blue.svg)](LICENSE)
[![OpenSSF Scorecard](https://api.securityscorecards.dev/projects/github.com/fabiocicerchia/depwatch/badge)](https://securityscorecards.dev/viewer/?uri=github.com/fabiocicerchia/depwatch)


Measures dependencies on two axes and plots them against each other:

- **Drift** — how far behind you are, in *libyears*. Objective and computable.
- **Viability** — can you even catch up? Maintainer activity, bus factor,
  release cadence, archived status, funding signals, last commit.

A dependency 0.2 libyears behind whose sole maintainer vanished is more dangerous
than one 4 libyears behind under active development. Existing tools measure one
axis or the other — **plotting both, the quadrant chart is the product** (and the
screenshot that sells it).

The libyear metric is from Cox, Bouwers, van Eekelen & Visser, "Measuring
Dependency Freshness in Software Systems" (ICSE 2015) — credited prominently.
Prior art to respect, not reinvent: libyear-bundler, libyear-npm,
jdanil/libyear, libyear-maven-plugin, `libyear` on PyPI. jdanil's split of
*drift* (version age) from *pulse* (time since the dep's latest release) is worth
stealing — pulse is the viability axis, nearly free from the same API responses.

## Status: working

```
npm install && npm run build
node dist/cli.js check package.json
```

```
depwatch check <manifest>              # table: drift + pulse + viability + quadrant
depwatch check <manifest> --json       # machine-readable, for CI
depwatch check <manifest> --ci --max-libyears 50 --max-replace 0
depwatch chart <manifest> --out q.svg  # the quadrant: drift × viability
depwatch trend <manifest>              # across git history — are we improving?
```

Manifests: `package.json`, `requirements*.txt`, `Cargo.toml`, `composer.json`
(or force one with `--eco`).

### Inputs, in order of accuracy

| Input | Versions | Ecosystems |
| --- | --- | --- |
| **SBOM** — CycloneDX or SPDX JSON | resolved | all of them, in one file |
| **lock file** — `package-lock.json`, `yarn.lock`, `pnpm-lock.yaml`, `Cargo.lock`, `composer.lock`, `Gemfile.lock` | resolved | one |
| **manifest** — `package.json`, `requirements.txt`, `Cargo.toml`, `composer.json` | range floors, so the total is an **upper bound** | one |

```
depwatch check bom.json          # anything syft, trivy or cdxgen already produces
```

An SBOM is the best input this tool takes: versions are resolved by definition,
and one file covers a polyglot repo that would otherwise need three separate
lock files. Each component is scored against its own registry via its PURL, so
npm, PyPI, Cargo, Composer and RubyGems components can sit in the same file.

Components from ecosystems with no registry depwatch can query — Go modules,
GitHub Actions, OS packages — are **counted and reported**, never quietly
dropped. "Your SBOM has 400 components and depwatch scored 12" is a sentence
that belongs on the output, not in an issue. Where the SBOM records a dependency
graph, the root's direct dependencies are used, for the same reason as below.

**Lock files are preferred automatically.** A manifest range states the *floor*
of what is allowed, not what is installed — `^18.3.1` reads as 18.3.1 even when
18.3.9 is in the lock file — so drift read from a manifest is systematically
overstated. Point depwatch at `package.json` and it will use the
`package-lock.json`, `yarn.lock`, `pnpm-lock.yaml`, `Cargo.lock` or
`composer.lock` beside it, while still scoring only the dependencies you chose
(`--transitive` for the whole tree, `--no-lock` to opt out). When any version did
come from a range, the total is labelled an upper bound rather than reported as a
measurement. On infra-toolbox's own manifest the difference is 24.17 libyears
against 10.67.

### Where the two axes come from

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

### Trend mode

Release dates are historical facts, so every past point is computable from
today's registry data: `depwatch trend` walks the manifest's `git log`, samples
evenly, and scores each revision as of that commit's date. Registry responses are
cached in-process, so the extra commits cost no extra requests.

## Kill criterion

If the quadrant view doesn't tell you something you didn't already know about
your own repos, stop.

## Contributing

See [CONTRIBUTING.md](CONTRIBUTING.md). Security issues go through
[GitHub Security Advisories](https://github.com/fabiocicerchia/depwatch/security/advisories/new),
never a public issue — see [SECURITY.md](SECURITY.md).

## License

Licensed under the Apache License, Version 2.0. See [LICENSE](LICENSE) and
[NOTICE](NOTICE).
