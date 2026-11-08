@domain:reports @area:ci-gates @from:src/commands
Feature: Checking CI gates from the editor
  Lets a developer see before pushing whether the findings would fail the same budget depwatch check --ci enforces.

  @id:vscode.reports.ci-gates.001 @rule:reports.ci-gates.unconfigured-points-to-settings @inferred @source:extensions/vscode/src/commands.ts#report
  Scenario: Checking gates with none configured explains how to set them
    Given neither depwatch.gates.maxLibyears nor depwatch.gates.maxReplace is set
    When the developer checks the gates
    Then a message explains that no gates are configured and names both settings
    And choosing "Open settings" opens the settings filtered to depwatch.gates

  @id:vscode.reports.ci-gates.002 @rule:reports.ci-gates.pass-or-fail-summary @inferred @source:extensions/vscode/src/commands.ts#report
  Scenario Outline: Checking gates reports a pass, or the failure count with the first failure
    Given depwatch.gates.maxLibyears is 10
    And <state>
    When the developer checks the gates
    Then <message>

    Examples:
      | state                             | message                                                                                                                             |
      | every manifest stays under budget | an information message reads "depwatch: gates pass."                                                                                |
      | two manifests exceed the budget   | a warning reads "depwatch: 2 gate(s) failing — <manifest label>: <first failure>" with a "Show report" action that opens the report |
