@domain:baseline @area:clear-baseline @from:src/baseline-file
Feature: Clearing the baseline
  Lets a developer drop every acceptance so the full list of findings is visible again.

  @id:vscode.baseline.clear-baseline.002 @rule:baseline.clear.no-folder-does-nothing @inferred @source:extensions/vscode/src/commands.ts#baselineCommands @questionable
  Scenario: Clearing without a workspace folder does nothing and says nothing
    Given no workspace folder is open
    When the developer clears the baseline
    Then no message is shown
    And the findings pane is unchanged
