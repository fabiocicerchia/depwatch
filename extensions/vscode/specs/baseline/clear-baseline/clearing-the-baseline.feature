@domain:baseline @area:clear-baseline @from:src/baseline-file
Feature: Clearing the baseline
  Lets a developer drop every acceptance so the full list of findings is visible again.

  @id:vscode.baseline.clear-baseline.001 @rule:baseline.clear.nothing-to-clear @verified @source:extensions/vscode/src/commands.ts#baselineCommands @test:extensions/vscode/src/extension.test.ts#says there was no baseline to clear when the file is not there
  Scenario: Clearing when there is no baseline says so
    Given a workspace folder is open
    And And there is no baseline file
    When the developer clears the baseline
    Then depwatch says "depwatch: there was no baseline to clear."

  @id:vscode.baseline.clear-baseline.002 @rule:baseline.clear.no-folder-does-nothing @inferred @source:extensions/vscode/src/commands.ts#baselineCommands @questionable
  Scenario: Clearing without a workspace folder does nothing and says nothing
    Given no workspace folder is open
    When the developer clears the baseline
    Then no message is shown
    And the findings pane is unchanged
