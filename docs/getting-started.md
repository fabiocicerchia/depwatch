# Getting Started

## Install and run

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

## Inputs, in order of accuracy

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
