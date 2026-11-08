@domain:scanning @area:scan-progress @from:src/scan-runner
Feature: Following, cancelling and understanding a scan
  Lets a developer see which manifest a scan is on, stop it without losing what was found, and tell a manifest that could not be read apart from one that simply has nothing to score.

  Background:
    Given the depwatch extension is enabled in a workspace

  @id:vscode.scanning.scan-progress.001 @rule:scanning.progress.where-progress-is-shown @inferred @source:extensions/vscode/src/scan-runner.ts#progressFor
  Scenario Outline: A requested scan reports progress in a cancellable notification, a background scan in the findings pane
    Given the workspace has the manifests "api/package.json" and "web/package.json"
    When <trigger> scans the workspace
    Then progress appears <location>
    And the progress reads "api/package.json (1/2)" and then "web/package.json (2/2)"
    And while a manifest is being looked up the progress reads its label followed by "<done>/<total>" dependencies answered

    Examples:
      | trigger             | location                                                      | done | total |
      | the developer       | as a "depwatch" notification with a Cancel button             | 3    | 12    |
      | a background rescan | in the Findings pane's own progress bar, with no notification | 3    | 12    |

  @id:vscode.scanning.scan-progress.002 @rule:scanning.progress.cancel-keeps-findings @inferred @source:extensions/vscode/src/scan-runner.ts#ScanRunner
  Scenario: Cancelling a workspace scan stops it and keeps what was already found
    Given a workspace scan is part-way through "web/package.json" after finishing "api/package.json"
    When the developer cancels the scan
    Then no further manifests are scanned
    And the findings for "api/package.json" and any already found for "web/package.json" stay shown
    And "web/package.json" is not listed as a manifest that could not be scanned
