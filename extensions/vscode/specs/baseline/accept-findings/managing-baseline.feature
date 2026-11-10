@domain:baseline @area:accept-findings @from:src/commands
Feature: Accepting and clearing the baseline
  Lets a team accept today's findings so only what gets worse shows, and undo that when they want everything back.

  @id:vscode.baseline.accept-findings.002 @rule:baseline.accept.needs-workspace-folder @inferred @source:extensions/vscode/src/commands.ts#baselineCommands
  Scenario: Accepting findings without an open workspace folder is refused
    Given no workspace folder is open
    When the developer accepts the current findings
    Then a warning reads "depwatch: a baseline needs an open workspace folder."
    And no baseline file is written

  @id:vscode.baseline.accept-findings.003 @rule:baseline.accept.writes-and-hides-accepted @inferred @source:extensions/vscode/src/commands.ts#baselineCommands
  Scenario: Accepting findings writes the baseline and hides them at once
    Given a workspace folder is open
    And the scans show 7 acceptable findings
    When the developer accepts the current findings
    Then the baseline file is written in the workspace folder
    And the 7 findings disappear from view, reusing the scans already in hand while they are within the refresh interval
    And a message reads "depwatch: accepted 7 finding(s) into <baseline file>. Only what gets worse will show from now on." with an "Open baseline" action

  @id:vscode.baseline.accept-findings.005 @rule:baseline.clear.shows-every-finding @inferred @source:extensions/vscode/src/commands.ts#baselineCommands @questionable
  Scenario Outline: Clearing the baseline deletes it and shows every finding again, or says there was none
    Given a workspace folder is open
    And <state>
    When the developer clears the baseline
    Then <message>

    Examples:
      | state                   | message                                                                                                                  |
      | a baseline file exists  | the file is deleted, the workspace is rescanned and "depwatch: baseline cleared. Every finding is shown again." is shown |
      | no baseline file exists | "depwatch: there was no baseline to clear." is shown                                                                     |
