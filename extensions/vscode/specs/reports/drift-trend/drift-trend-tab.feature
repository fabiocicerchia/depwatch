@domain:reports @area:drift-trend @from:src/panel
Feature: Viewing drift over history
  Shows developers how a manifest's drift has changed across git history, in a tab of its own.

  @id:vscode.reports.drift-trend.008 @rule:reports.drift-trend.opens-own-tab @inferred @source:extensions/vscode/src/panel.ts#showTrend @questionable
  Scenario: Each drift trend opens in its own tab named after the manifest
    Given drift history has been computed for "package.json"
    When the developer asks for the drift trend of "package.json"
    Then a new tab titled "depwatch trend — package.json" opens in the active column
    And the report tab, if open, is left as it was
    And asking again opens another trend tab rather than reusing the first
