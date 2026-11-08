@domain:findings-pane @area:quadrant-grouping @from:src/tree
Feature: Grouping findings by quadrant
  Developers read the findings pane top-down as a to-do list, so the worst dependencies must sit at the top under the quadrant that says what to do about them.

  Background:
    Given the findings pane is open in project scope

  @id:vscode.findings-pane.quadrant-grouping.001 @rule:findings.grouping.worst-quadrant-first @verified @source:extensions/vscode/src/tree.ts#groupsOf @test:extensions/vscode/src/tree.test.ts#runs worst quadrant first and leaves out the empty ones @test:extensions/vscode/src/tree.test.ts#keeps the unscored ones in their own group, after the quadrants
  Scenario Outline: Quadrant groups run worst first, unscored last, and empty quadrants get no heading
    Given a manifest has dependencies in the <present> quadrants
    When the developer looks at the findings pane
    Then the pane shows the groups <groups> in that order
    And no heading appears for a quadrant with no dependencies

    Examples:
      | present                                                    | groups                  |
      | Replace, Watch, Healthy                                    | Replace, Watch, Healthy |
      | Replace and one dependency the registry did not answer for | Replace, no data        |

  @id:vscode.findings-pane.quadrant-grouping.002 @rule:findings.grouping.worst-drift-first-within-group @verified @source:extensions/vscode/src/tree.ts#worstFirst @test:extensions/vscode/src/tree.test.ts#orders a group by drift, then viability, then name
  Scenario: Within a quadrant, the most drift comes first, then the lowest viability, then the name
    Given the Replace quadrant holds "b" and "a" at 1 libyear and viability 0.30, "worst" at 9 libyears, and "tied-low-viability" at 1 libyear and viability 0.10
    When the developer opens the Replace group
    Then the dependencies are listed as worst, tied-low-viability, a, b

  @id:vscode.findings-pane.quadrant-grouping.003 @rule:findings.grouping.unscored-listed-once @verified @source:extensions/vscode/src/tree.ts#groupsOf @test:extensions/vscode/src/tree.test.ts#keeps the unscored ones in their own group, after the quadrants
  Scenario: A dependency the registry did not answer for is listed only under no data, never also under its quadrant
    Given "scored" is in the Replace quadrant
    And "unreachable" carries the Replace quadrant but the registry timed out for it
    When the developer looks at the findings pane
    Then the Replace group lists only "scored"
    And the no data group lists only "unreachable", described as "timeout"
