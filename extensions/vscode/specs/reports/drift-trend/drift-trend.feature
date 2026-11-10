@domain:reports @area:drift-trend @from:src/commands
Feature: Showing drift over git history
  Lets a developer see whether a manifest's drift is getting better or worse over time.

  @id:vscode.reports.drift-trend.001 @rule:reports.drift-trend.history-tab @inferred @source:extensions/vscode/src/commands.ts#report
  Scenario: Showing the trend reads the manifest's git history and opens it in its own tab
    Given packages/api/package.json sits in a workspace folder under git
    When the developer shows the drift trend
    Then a progress notification reads "depwatch: reading history of packages/api/package.json"
    And a trend tab for packages/api/package.json opens, limited to the configured number of points

  @id:vscode.reports.drift-trend.002 @rule:reports.drift-trend.needs-workspace-folder @inferred @source:extensions/vscode/src/commands.ts#report
  Scenario: A manifest outside every workspace folder has no trend
    Given the chosen manifest is outside every workspace folder
    When the developer shows the drift trend
    Then a warning reads "depwatch: trend needs the manifest to sit inside a workspace folder."

  @id:vscode.reports.drift-trend.003 @rule:reports.drift-trend.missing-git-offers-install @inferred @source:extensions/vscode/src/commands.ts#showHistory
  Scenario: When git is missing, the trend failure offers to install it in a terminal
    Given git is not installed
    When the developer shows the drift trend
    Then a warning names the failure and offers to run the git install command
    And accepting opens a "depwatch: install git" terminal with the install command typed into it
    And any other failure is shown as a plain warning with no offer
