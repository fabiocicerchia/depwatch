# Specifications of depwatch

What this code does, one atomic Gherkin scenario per behaviour, read from the code by code-atlas.
Tags: `@verified` a test asserts it · `@inferred` read from the code only · `@gap` an entry point no test covers · `@human` written or amended by a person, never rewritten.

## Command line

The depwatch CLI that users and scripts invoke.

- **Commands**: [Running depwatch from the command line](command-line/commands/cli-commands.feature) (6)
- **Options and arguments**: [Giving the CLI its options](command-line/options/cli-option-grammar.feature) (5), [Choosing and listing supported ecosystems on the command line](command-line/options/ecosystem-option-and-help.feature) (2)

## Dependency discovery

Finding a project's dependencies and their pinned versions from manifests, lock files and SBOMs.

- **Direct vs transitive dependencies**: [Counting only the dependencies the project chose](dependency-discovery/direct-vs-transitive/direct-dependencies-from-lock.feature) (3)
- **File format parsing**: [Reading stated versions from manifests and lock files](dependency-discovery/file-format-parsing/version-floors-and-pins.feature) (7), [Reading YAML manifests and lock files](dependency-discovery/file-format-parsing/yaml-manifest-reading.feature) (4)
- **Manifest detection**: [Recognising a dependency file's ecosystem from its name](dependency-discovery/manifest-detection/ecosystem-from-filename.feature) (3), [Reading the lock file beside a manifest](dependency-discovery/manifest-detection/lock-file-preference.feature) (4), [Recognising which ecosystem an input file belongs to](dependency-discovery/manifest-detection/recognising-manifests.feature) (2)
- **SBOM input**: [Being told what an SBOM contributed](dependency-discovery/sbom-input/sbom-input-summary.feature) (2), [Reading an SBOM as the dependency list](dependency-discovery/sbom-input/sbom-input.feature) (7), [Assigning SBOM components to ecosystems by package URL type](dependency-discovery/sbom-input/sbom-package-url-ecosystems.feature) (1)

## Drift measurement

The objective axis: how far behind each dependency and the whole project are, in libyears.

- **Libyear calculation**: [Measuring dependency drift in libyears](drift/libyear-calculation/libyear-drift.feature) (7)
- **Reported precision**: [Reporting drift at two decimals](drift/precision/drift-precision.feature) (2)
- **Drift trend over time**: [Tracking drift over a manifest's history](drift/trend/drift-trend.feature) (5)
- **Version comparison**: [Ordering versions to find installed and newest releases](drift/version-comparison/version-ordering.feature) (4)

## Ecosystem support

Per-package-manager knowledge of manifest formats and where each ecosystem publishes its release history.

- **Infrastructure as code**: [Tracking Docker base images](ecosystem-support/infrastructure/docker-base-images.feature) (7), [Measuring GitHub Actions used by workflows](ecosystem-support/infrastructure/github-actions-dependencies.feature) (8), [Scoring Helm chart dependencies](ecosystem-support/infrastructure/helm-charts.feature) (5), [Measuring Terraform and OpenTofu provider drift](ecosystem-support/infrastructure/terraform-providers.feature) (7)
- **JavaScript**: [Scoring Bun projects from their lock files](ecosystem-support/javascript/bun-lockfiles.feature) (5), [Reading npm and Bun projects](ecosystem-support/javascript/npm-and-bun-dependencies.feature) (3), [Reading npm manifests and lock files](ecosystem-support/javascript/npm-manifests-and-locks.feature) (5)
- **JVM and .NET**: [Scoring Maven and Gradle projects](ecosystem-support/jvm-and-dotnet/maven-projects.feature) (7), [Measuring drift of NuGet packages](ecosystem-support/jvm-and-dotnet/nuget-packages.feature) (8)
- **Mobile**: [Scoring CocoaPods dependencies](ecosystem-support/mobile/cocoapods-dependencies.feature) (5), [Measuring Dart and Flutter dependencies from pub.dev](ecosystem-support/mobile/pub-dart-flutter.feature) (7)
- **Python**: [Measuring drift in conda environments](ecosystem-support/python/conda-environments.feature) (7), [Reading pip requirements files](ecosystem-support/python/pip-requirements.feature) (2), [Measuring Python dependencies published on PyPI](ecosystem-support/python/python-pypi-dependencies.feature) (5), [Reading dependencies from pyproject.toml](ecosystem-support/python/python-pyproject-dependencies.feature) (6)
- **Systems languages**: [Measuring Go module dependencies](ecosystem-support/systems-languages/go-modules.feature) (6), [Reading Rust crate dependencies](ecosystem-support/systems-languages/rust-crate-dependencies.feature) (5)
- **PHP, Ruby and Elixir**: [Measuring PHP Composer dependencies](ecosystem-support/web-and-scripting/composer-dependencies.feature) (5), [Measuring Elixir and Erlang dependencies from Hex](ecosystem-support/web-and-scripting/hex-packages.feature) (4), [Measuring Ruby gem drift from Gemfile.lock](ecosystem-support/web-and-scripting/rubygems-support.feature) (6)

## Editor integration

Bringing depwatch results into the editor while dependencies are being edited.

- **Editor commands and triggers**: [Scanning a project from Neovim](editor-integration/editor-commands/nvim-scanning.feature) (6)
- **Results and notifications**: [Reviewing findings in lists and reports](editor-integration/editor-results/nvim-findings-lists.feature) (4)
- **Setup and health**: [Configuring and health-checking the Neovim plugin](editor-integration/editor-setup/nvim-setup-health.feature) (5)

## Policy and CI gates

Turning a report into a pass or fail verdict and keeping long-lived projects focused on what got worse.

- **Accepted baselines**: [Accepting today's findings](policy-gates/baselines/accepted-baseline.feature) (5), [Accepting today's findings and reporting only what gets worse](policy-gates/baselines/accepted-baselines.feature) (5), [Accepting a baseline from the editor](policy-gates/baselines/nvim-baseline.feature) (1)
- **CI integration**: [Gating a non-GitHub CI pipeline on dependency drift](policy-gates/ci-integration/ci-pipeline-gate.feature) (5)
- **Pass/fail gates**: [Checking CI gates from the editor](policy-gates/gates/nvim-gates.feature) (2), [Failing a check on drift and replace thresholds](policy-gates/gates/pass-fail-gates.feature) (6)

## Registry access

Fetching version timelines and package metadata from package registries and repository hosts, politely and resiliently.

- **Failure handling**: [Explaining why a dependency could not be looked up](registry-access/failure-handling/registry-failure-reasons.feature) (1)
- **Version history lookup**: [Reading release dates and repository links from registries](registry-access/version-history/registry-dates-and-links.feature) (2), [Looking up published versions from package registries](registry-access/version-history/registry-version-lookup.feature) (3)

## Reporting

Presenting drift against viability so people can see what to update, replace or leave alone.

- **Pull request summary**: [Summarising a depwatch check in a GitHub Actions run](reporting/pull-request-summary/pull-request-check-summary.feature) (8)
- **Quadrant chart**: [Plotting dependencies on the drift × viability quadrant chart](reporting/quadrant-chart/quadrant-chart.feature) (6)
- **Report assembly**: [Scoring a manifest on drift and viability](reporting/report-assembly/scoring-a-manifest.feature) (6)
- **Terminal output**: [Reading a dependency report in the terminal](reporting/terminal-output/terminal-report.feature) (6)

## Viability assessment

The heuristic axis: whether a dependency's project is alive enough for catching up to be possible.

- **Maintainer and repository signals**: [Gathering maintainer and repository signals on request](viability/maintainer-signals/maintainer-and-repository-signals.feature) (4)
- **Release activity signals**: [Judging release activity from a package's version history](viability/release-signals/release-activity-signals.feature) (3)
- **Viability score**: [Scoring dependency viability](viability/viability-score/viability-score.feature) (7)
