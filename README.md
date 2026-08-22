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

![depwatch quadrant chart — drift × viability for depwatch's own package-lock.json](docs/quadrant.svg)

The libyear metric is from Cox, Bouwers, van Eekelen & Visser, "Measuring
Dependency Freshness in Software Systems" (ICSE 2015) — credited prominently.
Prior art to respect, not reinvent: libyear-bundler, libyear-npm,
jdanil/libyear, libyear-maven-plugin, `libyear` on PyPI. jdanil's split of
*drift* (version age) from *pulse* (time since the dep's latest release) is worth
stealing — pulse is the viability axis, nearly free from the same API responses.

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
ecosystem registry, so it cannot drift from the code.

### Starting from where you are

A repository that has been running for years opens at 88 libyears and fifty-odd
dependencies to address. All of it is true and none of it is news, and a list
that never empties is a list people stop reading. A baseline records what today
looks like; afterwards only what got worse is reported.

```sh
node dist/cli.js check package.json --write-baseline   # accept today
node dist/cli.js check package.json --ci --max-libyears 5
```

Two things count as worse, and both matter: more drift than was accepted, and a
worse quadrant at the same drift — a dependency whose maintainer walked away
since you signed off has changed in exactly the way this tool exists to notice.

`.depwatch-baseline.json` is meant to be committed: it is the same file the VS
Code extension writes and reads, so the team shares one answer to "how much
drift do we already live with".

## In your editor

The [VS Code extension](extensions/vscode/) puts both axes on the manifest you
are editing: quadrant squiggles with a hover that explains the score, a findings
pane filtered to the current file or the whole project, the CI gates evaluated
live, and the same quadrant report in a tab.

```sh
make ext-install   # build, package a VSIX and install it into VS Code
```

## Documentation

Full docs live in [`docs/`](docs/) — including [the extension's design](docs/vscode.md).
Runnable examples live in [`examples/`](examples/).

## Contributing

See [CONTRIBUTING.md](CONTRIBUTING.md). Security issues go through
[GitHub Security Advisories](https://github.com/fabiocicerchia/depwatch/security/advisories/new),
never a public issue — see [SECURITY.md](SECURITY.md).

## License

Licensed under the Apache License, Version 2.0. See [LICENSE](LICENSE).
