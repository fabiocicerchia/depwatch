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
depwatch check <manifest> --ci --max-libyears-increase 0 --baseline base.json
depwatch chart <manifest> --out q.svg  # the quadrant: drift × viability
depwatch trend <manifest>              # across git history — are we improving?
```

depwatch recognises the manifest and lock files of many ecosystems and picks the
right one from the filename (or force one with `--eco`). Run `depwatch --help`
for the authoritative list — it is generated from the ecosystem registry, so it
cannot drift from what the code actually reads.

## Inputs, in order of accuracy

| Input | Versions | Ecosystems |
| --- | --- | --- |
| **SBOM** — CycloneDX or SPDX JSON | resolved | all of them, in one file |
| **lock file** — e.g. `package-lock.json`, `poetry.lock`, `Cargo.lock`, `Gemfile.lock`, `pubspec.lock`, `mix.lock`, `packages.lock.json`, `Chart.lock`, `.terraform.lock.hcl` | resolved | one |
| **manifest** — e.g. `package.json`, `pyproject.toml`, `Cargo.toml`, `go.mod`, `pom.xml`, `*.csproj`, `*.tf`, a `Dockerfile` | range floors (or resolved, per file), so the total may be an **upper bound** | one |

```
depwatch check bom.json          # anything syft, trivy or cdxgen already produces
```

An SBOM is the best input this tool takes: versions are resolved by definition,
and one file covers a polyglot repo that would otherwise need three separate
lock files. Each component is scored against its own registry via its PURL, so
components from any supported ecosystem — npm, PyPI, Cargo, Composer, RubyGems,
Go, Maven, NuGet, pub.dev, Hex and more — can sit in the same file.

Components from ecosystems with no registry depwatch can query — OS packages
(`deb`, `apk`, `rpm`), and other niche types — are **counted and reported**,
never quietly dropped. Go modules and GitHub Actions, once in that list, are now
scored. "Your SBOM has 400 components and depwatch scored 12" is a sentence
that belongs on the output, not in an issue. Where the SBOM records a dependency
graph, the root's direct dependencies are used, for the same reason as below.

**Lock files are preferred automatically.** A manifest range states the *floor*
of what is allowed, not what is installed — `^18.3.1` reads as 18.3.1 even when
18.3.9 is in the lock file — so drift read from a manifest is systematically
overstated. Point depwatch at `package.json` and it will use the
lock file beside it (`package-lock.json`, `poetry.lock`, `Cargo.lock`,
`composer.lock`, `pubspec.lock`, and so on), while still scoring only the
dependencies you chose
(`--transitive` for the whole tree, `--no-lock` to opt out). When any version did
come from a range, the total is labelled an upper bound rather than reported as a
measurement. On infra-toolbox's own manifest the difference is 24.17 libyears
against 10.67.

## Ecosystems

depwatch reads the manifest and lock files of these ecosystems. The list is
generated from the code by `depwatch --help`, so it never drifts from reality.

| Ecosystem | Recognised files |
| --- | --- |
| npm (JS/TS) | `package.json`, `package-lock.json`, `yarn.lock`, `pnpm-lock.yaml`, `bun.lock` |
| Python (PyPI) | `requirements*.txt`, `pyproject.toml` (Poetry & PEP 621), `poetry.lock`, `uv.lock` |
| Rust (crates.io) | `Cargo.toml`, `Cargo.lock` |
| PHP (Packagist) | `composer.json`, `composer.lock` |
| Ruby (RubyGems) | `Gemfile.lock` |
| Dart/Flutter (pub.dev) | `pubspec.yaml`, `pubspec.lock` |
| Elixir/Erlang (Hex) | `mix.exs`, `mix.lock` |
| .NET (NuGet) | `packages.config`, `*.csproj`, `packages.lock.json` |
| Swift/ObjC (CocoaPods) | `Podfile.lock` |
| conda | `environment.yml`, `conda-lock.yml` |
| Helm | `Chart.yaml`, `Chart.lock` |
| Go modules | `go.mod` (go.sum is checksums, not versions — see below) |
| Java/Kotlin (Maven Central) | `pom.xml`, `build.gradle(.kts)`, `gradle.lockfile` |
| Terraform/OpenTofu | `.terraform.lock.hcl`, `*.tf` |
| GitHub Actions | `.github/workflows/*.yml`, `action.yml` |
| Docker | `Dockerfile`, `Containerfile` (pulse & viability only — see below) |

**Go has no lock file, and that is not a gap.** Minimal version selection means
the version beside each `require` in `go.mod` *is* the one that builds, so the
manifest is already resolved — there is no range to widen and nothing for a lock
to pin down. `go.sum` is a checksum database: one hash per module version, and it
keeps versions that are no longer selected, so it cannot say which version you
are on. Point depwatch at `go.mod`; handing it `go.sum` explains this rather than
guessing.

**Docker is scored on one axis.** A container tag has an honest publish date but
no orderable version series — `library/node` alone has thousands of tags, most
of them moving aliases pushed the same day — so drift cannot be computed without
a heuristic. depwatch reports how old the exact base-image tag is (pulse) and
whether the image is still maintained (viability), and shows drift as `—`. "Your
base image tag is 14 months old" is the useful, objective sentence.

### Not covered, and why

These are deliberately out of scope, not oversights:

- **OS package managers** — `dpkg`/`apt`, `apk`, `yum`/`dnf`, `snap`, `flatpak`,
  Homebrew. Distribution versions are *backported*: Debian's `nginx
  1.22.1-9+deb12u1` would score years behind while actively receiving security
  fixes. That is a **wrong** number, not a missing one, and it breaks the rule
  that drift stay objectively computable. (This is a different objection from
  Docker's: a Docker tag's date is honest and only its ordering is unusable,
  which is why Docker gets a pulse-only tier and distro packages get none.) SBOM
  components of these types are counted and reported, never scored.
- **Editor plugin managers** — Pathogen, Vundle, vim-plug. Plugins are unpinned
  git repositories: there is no version to date, so drift is not computable.
- **Pulumi** — Pulumi programs depend on npm, PyPI, NuGet or Go packages, so
  they are already covered through those ecosystems.
- **LuaRocks, vcpkg** — deferred: neither exposes a version list with reliable
  publish dates that this tool can query without guessing.
