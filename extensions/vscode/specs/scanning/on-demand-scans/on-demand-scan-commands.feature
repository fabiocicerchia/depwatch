@domain:scanning @area:on-demand-scans @from:src/commands
Feature: Scanning on demand
  Lets a developer scan the manifest they mean, or cancel a scan, without guessing which file depwatch will pick.

  Background:
    Given a workspace containing dependency manifests is open in the editor

  @id:vscode.scanning.on-demand-scans.001 @rule:scanning.on-demand.target-manifest-choice @inferred @source:extensions/vscode/src/commands.ts#activeManifest
  Scenario Outline: A single-manifest command acts on the open manifest, the only manifest, or the one the developer picks
    Given the active editor shows <active_file>
    And the workspace has <manifest_count> manifest(s)
    When the developer scans the current file
    Then <outcome>

    Examples:
      | active_file  | manifest_count | outcome                                                                                                   |
      | package.json | 3              | package.json is scanned without asking                                                                    |
      | README.md    | 1              | the single manifest is scanned without asking                                                             |
      | README.md    | 3              | a "Which manifest?" picker lists the 3 manifests by workspace-relative path and the picked one is scanned |

  @id:vscode.scanning.on-demand-scans.002 @rule:scanning.on-demand.no-manifest-warning @inferred @source:extensions/vscode/src/commands.ts#activeManifest
  Scenario: Asking to scan a file when the workspace has no manifest warns instead
    Given the active editor does not show a manifest
    And the workspace has no dependency manifest
    When the developer scans the current file
    Then a warning reads "depwatch: no dependency manifest found."
    And no scan runs

  @id:vscode.scanning.on-demand-scans.003 @rule:scanning.progress.cancel-without-running-scan @inferred @source:extensions/vscode/src/commands.ts#scanning
  Scenario: Cancelling when nothing is scanning says so
    Given no scan is running
    When the developer cancels the scan
    Then an information message reads "depwatch: no scan is running."

  @id:vscode.scanning.on-demand-scans.004 @rule:scanning.on-demand.deep-scan-shows-progress @inferred @source:extensions/vscode/src/commands.ts#scanning
  Scenario: A deep scan rescans the whole workspace under a visible progress notification
    Given earlier scan results exist
    When the developer runs a deep scan
    Then a "depwatch: deep scan" progress notification is shown while it runs
    And every manifest is rescanned with the deep viability signals, even those whose dependencies have not changed
