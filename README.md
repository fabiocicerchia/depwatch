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

## In your editor

The [VS Code extension](extensions/vscode/) puts both axes on the manifest you
are editing: quadrant squiggles with a hover that explains the score, a findings
pane filtered to the current file or the whole project, the CI gates evaluated
live, and the same quadrant report in a tab.

```sh
cd extensions/vscode && npm install && npm run build   # then F5, or vsce package
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
