@domain:baseline @area:accept-findings @from:src/baseline-file
Feature: Accepting findings into a baseline
  Lets a team record the drift it already lives with in a committed file, so the findings pane only shows what has got worse since.

  Background:
    Given Given a workspace folder is open
    And And depwatch has scanned the workspace's manifests

  @id:vscode.baseline.accept-findings.001 @rule:baseline.accept.reaccepting-keeps-earlier-acceptances @inferred @source:extensions/vscode/src/commands.ts#baselineCommands
  Scenario: Accepting again keeps what was accepted before
    Given the baseline already accepts lodash in package.json, so it is hidden
    And And left-pad has since become a new finding
    When the developer accepts the current findings
    Then .depwatch-baseline.json lists both lodash and left-pad
    And depwatch says it accepted 2 finding(s)
    And neither lodash nor left-pad is listed in the findings pane
