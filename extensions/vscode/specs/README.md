# Specifications of depwatch / extensions/vscode

What this code does, one atomic Gherkin scenario per behaviour, read from the code by code-atlas.
Tags: `@verified` a test asserts it · `@inferred` read from the code only · `@gap` an entry point no test covers · `@human` written or amended by a person, never rewritten.

## Automatic rescans

Deciding when a scan runs on its own without disturbing the user.

- **Lock file and package manager changes**: [Rescanning after a lock file changes](automatic-rescans/lockfile-changes/lock-file-rescans.feature) (1)
- **Periodic re-check**: [Periodic re-check for new releases](automatic-rescans/periodic-recheck/periodic-recheck-wiring.feature) (1), [Periodically re-checking for new releases](automatic-rescans/periodic-recheck/periodic-recheck.feature) (4)
- **Rescan on save**: [Rescanning manifests that change on disk](automatic-rescans/rescan-on-save/rescan-changed-manifests.feature) (2), [Rescanning a manifest after it is saved](automatic-rescans/rescan-on-save/rescan-on-save-debounce.feature) (2)
- **Duplicate scan prevention**: [Not scanning the same manifest twice at once](automatic-rescans/scan-coalescing/scan-coalescing.feature) (2)

## Baseline

Recording the drift a team accepts today so only new findings are flagged.

- **Accepting findings**: [Accepting findings into a baseline](baseline/accept-findings/accepting-findings-into-a-baseline.feature) (1), [Accepting and clearing the baseline](baseline/accept-findings/managing-baseline.feature) (3)
- **Baseline sync**: [Following the baseline file](baseline/baseline-sync/baseline-file-sync.feature) (1)
- **Clearing the baseline**: [Clearing the baseline](baseline/clear-baseline/clearing-the-baseline.feature) (1)

## Findings pane

The side pane that lists findings worst-first and sums up the drift being carried.

- **Filtering and expanding**: [Filtering findings by quadrant](findings-pane/filtering/filtering-findings.feature) (2)
- **Quadrant grouping**: [Grouping findings by quadrant](findings-pane/quadrant-grouping/findings-quadrant-grouping.feature) (3)
- **Status bar**: [Total drift in the status bar](findings-pane/status-bar/status-bar-drift.feature) (5)
- **Totals**: [Reading the bottom line of the findings pane](findings-pane/totals/findings-pane-totals.feature) (6)

## In-editor findings

Showing what each dependency's problem is right where it is written in the manifest.

- **Dependency location**: [Pointing findings at the line that declares the dependency](in-editor-findings/dependency-location/dependency-location.feature) (6)
- **Squiggles and Problems**: [Flagging dependencies in the manifest and the Problems panel](in-editor-findings/diagnostics/dependency-squiggles.feature) (7)
- **Hover explanations**: [Explaining a dependency on hover](in-editor-findings/hover-explanations/dependency-hover.feature) (3), [Explaining dependency findings in plain language](in-editor-findings/hover-explanations/explaining-findings.feature) (8)

## Registry cache

Keeping registry lookups cheap, offline-tolerant and rate-limit friendly.

- **Clearing the cache**: [Clearing the registry cache](registry-cache/cache-reset/clearing-registry-cache-store.feature) (1), [Clearing the registry cache](registry-cache/cache-reset/clearing-registry-cache.feature) (1)
- **Version and release caching**: [Reusing registry answers between scans](registry-cache/version-cache/registry-answer-reuse.feature) (5)

## Reports

The full two-axis report and its exports.

- **CI gate check**: [Checking CI gates from the editor](reports/ci-gates/checking-ci-gates.feature) (2)
- **Drift over history**: [Seeing a manifest's drift over its history](reports/drift-trend/drift-trend-page.feature) (4), [Viewing drift over history](reports/drift-trend/drift-trend-tab.feature) (1), [Showing drift over git history](reports/drift-trend/drift-trend.feature) (3)
- **Export**: [Exporting the report and chart](reports/export/exporting-reports.feature) (3), [Exporting the report as a standalone page](reports/export/report-export.feature) (2)
- **Report panel**: [Reading the depwatch report](reports/report-panel/report-page.feature) (7), [Opening the report and jumping to a dependency](reports/report-panel/report-panel-commands.feature) (2), [Viewing the dependency report in the editor](reports/report-panel/report-panel.feature) (5)

## Scanning

Finding dependency manifests in the workspace and measuring their drift and viability from inside the editor.

- **Incremental results**: [Showing scan results as they arrive and skipping unchanged work](scanning/incremental-results/incremental-scan-results.feature) (1)
- **Manifest discovery**: [Honouring the project's excludes](scanning/manifest-discovery/honouring-excludes.feature) (5), [Finding the manifests to scan in a workspace](scanning/manifest-discovery/workspace-manifest-discovery.feature) (2)
- **On-demand scans**: [Scanning on demand](scanning/on-demand-scans/on-demand-scan-commands.feature) (4)
- **Progress and cancellation**: [Showing each manifest's latest scan outcome](scanning/scan-progress/manifest-scan-outcome.feature) (1), [Following, cancelling and understanding a scan](scanning/scan-progress/scan-progress-and-failures.feature) (2)

## Setup and settings

Activating the extension and configuring how it behaves.

- **Activation and commands**: [Starting depwatch in the editor](setup/activation/extension-startup.feature) (2)
- **GitHub token**: [Using the stored GitHub token](setup/credentials/github-token-at-startup.feature) (1), [Storing the GitHub token](setup/credentials/github-token.feature) (2)
- **Settings**: [Settings that decide what gets scanned](setup/settings/scan-settings.feature) (4)
