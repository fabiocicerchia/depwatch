@domain:scanning @area:incremental-results @from:src/engine
Feature: Showing scan results as they arrive and skipping unchanged work
  Keeps the findings for large manifests coming in while a scan runs, and keeps rescans cheap when nothing that affects the numbers has changed.

  Background:
    Given a workspace is open in the editor

  @id:vscode.scanning.incremental-results.001 @rule:scanning.incremental.unsaved-edits-are-scanned @inferred @source:extensions/vscode/src/engine.ts#readText
  Scenario: A manifest open in the editor is scanned as currently typed, including unsaved edits
    Given "package.json" is open in the editor with an unsaved edit pinning lodash to 4.17.21
    And the saved file on disk pins lodash to 4.17.20
    And no lock file sits beside it
    When the manifest is scanned
    Then the findings report lodash at 4.17.21
